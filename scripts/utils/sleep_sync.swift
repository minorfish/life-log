import Cocoa
import EventKit
import Foundation

// sleep_sync.swift — Create calendar events using EventKit (no AppleScript/Automation needed).
//
// Launched via:  open -W sleep_sync.app   (NO --args — Launch Services drops them)
// Reads input from fixed path: /tmp/sleep_sync_input.json
// Writes output to path specified inside the input JSON's "outputPath" field.
//
// Input JSON:
//   { "calendarName": "睡眠", "outputPath": "/tmp/sleep_sync_output_xxx.json",
//     "events": [{ "start": epochMs, "end": epochMs, "title": "...", "notes": "..." }] }
//
// Output JSON:
//   { "created": 1, "skipped": 0, "failed": [], "total": 1,
//     "createdStarts": [123...], "calendarUsed": "睡眠", "error": null }
//
// This binary runs inside an .app bundle with NSApplication so macOS shows a proper
// Calendar permission prompt on first run. The .accessory policy means no Dock icon.

let INPUT_PATH = "/tmp/sleep_sync_input.json"

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// --- Read input ---
guard let inputData = FileManager.default.contents(atPath: INPUT_PATH),
      let input = try? JSONSerialization.jsonObject(with: inputData) as? [String: Any] else {
    // Can't even read input — write error to a fallback path
    let err: [String: Any] = ["error": "Cannot read input at \(INPUT_PATH)", "created": 0, "total": 0]
    try? JSONSerialization.data(withJSONObject: err).write(to: URL(fileURLWithPath: "/tmp/sleep_sync_output.json"))
    exit(1)
}

let calendarName = input["calendarName"] as? String ?? "睡眠"
let outputPath = input["outputPath"] as? String ?? "/tmp/sleep_sync_output.json"
let eventsArray = input["events"] as? [[String: Any]] ?? []

struct Ev {
    let start: Date
    let end: Date
    let title: String
    let notes: String
    let startMs: Double
}

var events: [Ev] = []
for e in eventsArray {
    guard let s = e["start"] as? Double, let en = e["end"] as? Double, let t = e["title"] as? String else { continue }
    events.append(Ev(
        start: Date(timeIntervalSince1970: s / 1000),
        end: Date(timeIntervalSince1970: en / 1000),
        title: t,
        notes: e["notes"] as? String ?? "",
        startMs: s
    ))
}

func writeOutput(_ data: [String: Any], _ code: Int32) -> Never {
    if let d = try? JSONSerialization.data(withJSONObject: data) {
        try? d.write(to: URL(fileURLWithPath: outputPath))
    }
    exit(code)
}

if events.isEmpty {
    writeOutput(["created": 0, "skipped": 0, "failed": [], "total": 0, "createdStarts": [], "calendarUsed": ""], 0)
}

let store = EKEventStore()
var created = 0
var failed: [[String: Any]] = []
var createdStarts: [Double] = []
var calendarUsed = ""

func createEvents(on cal: EKCalendar) {
    calendarUsed = cal.title
    for ev in events {
        let event = EKEvent(eventStore: store)
        event.title = ev.title
        event.startDate = ev.start
        event.endDate = ev.end
        event.notes = ev.notes
        event.calendar = cal
        do {
            try store.save(event, span: .thisEvent)
            created += 1
            createdStarts.append(ev.startMs)
        } catch {
            failed.append(["title": ev.title, "start": ev.startMs, "error": error.localizedDescription])
        }
    }
}

func doSync() {
    let st = EKEventStore.authorizationStatus(for: .event)
    switch st {
    case .fullAccess:
        let cals = store.calendars(for: .event)
        if let target = cals.first(where: { $0.title == calendarName }) {
            createEvents(on: target)
        } else if let def = store.defaultCalendarForNewEvents {
            createEvents(on: def)
        }
    case .writeOnly:
        if let def = store.defaultCalendarForNewEvents {
            createEvents(on: def)
        }
    case .denied, .restricted:
        // Once denied, macOS will NOT show the permission prompt again — silently
        // reporting "0 created" here would be indistinguishable from "already
        // synced". Surface it explicitly so the caller can tell the user to
        // grant access manually.
        writeOutput([
            "error": "Calendar permission was denied. Open System Settings → Privacy & Security → Calendar, enable access for \"SleepSync\", then try again.",
            "created": 0, "total": events.count
        ], 1)
    default:
        writeOutput([
            "error": "Unexpected Calendar authorization status (\(st.rawValue)).",
            "created": 0, "total": events.count
        ], 1)
    }
    writeOutput([
        "created": created, "skipped": 0, "failed": failed,
        "total": events.count, "createdStarts": createdStarts, "calendarUsed": calendarUsed
    ], 0)
}

let status = EKEventStore.authorizationStatus(for: .event)

if status == .notDetermined {
    // First run — macOS will show a Calendar permission prompt.
    // app.run() provides the event loop needed for the prompt UI.
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { granted, _ in
            DispatchQueue.main.async {
                if granted {
                    let ns = EKEventStore.authorizationStatus(for: .event)
                    if ns == .fullAccess {
                        let cals = store.calendars(for: .event)
                        if let target = cals.first(where: { $0.title == calendarName }) {
                            createEvents(on: target)
                        } else if let def = store.defaultCalendarForNewEvents {
                            createEvents(on: def)
                        }
                    } else if ns == .writeOnly {
                        if let def = store.defaultCalendarForNewEvents {
                            createEvents(on: def)
                        }
                    }
                    writeOutput([
                        "created": created, "skipped": 0, "failed": failed,
                        "total": events.count, "createdStarts": createdStarts, "calendarUsed": calendarUsed
                    ], 0)
                } else {
                    writeOutput([
                        "error": "Calendar permission not granted. Please allow in System Settings → Privacy & Security → Calendar.",
                        "created": 0, "total": events.count
                    ], 1)
                }
            }
        }
    } else {
        store.requestAccess(to: .event) { granted, _ in
            DispatchQueue.main.async {
                if granted {
                    let cals = store.calendars(for: .event)
                    if let target = cals.first(where: { $0.title == calendarName }) {
                        createEvents(on: target)
                    } else if let def = store.defaultCalendarForNewEvents {
                        createEvents(on: def)
                    }
                    writeOutput([
                        "created": created, "skipped": 0, "failed": failed,
                        "total": events.count, "createdStarts": createdStarts, "calendarUsed": calendarUsed
                    ], 0)
                } else {
                    writeOutput(["error": "Calendar permission not granted.", "created": 0, "total": events.count], 1)
                }
            }
        }
    }
} else {
    doSync()
}

app.run()
