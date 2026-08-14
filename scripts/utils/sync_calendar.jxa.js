// JXA (JavaScript for Automation) helper that writes events into macOS Calendar.app.
// Invoked via: osascript -l JavaScript sync_calendar.jxa.js <calendarName> <eventsJsonPath>
// Each event in the JSON file: { start: epochMs, end: epochMs, title: string, notes: string }
//
// Robustness: does NOT require read permission. Reading existing events for
// de-duplication is wrapped in try/catch — under "add-only" Calendar access the
// read throws, in which case we skip de-dup and still create the event. Callers
// can avoid duplicates by passing only events not already synced (see the
// local cache in sleep_calendar_sync.ts).

function run(argv) {
  ObjC.import("Foundation");

  var calName = argv[0];
  var jsonPath = argv[1];

  var nsData = $.NSString.stringWithContentsOfFileEncodingError(
    jsonPath,
    $.NSUTF8StringEncoding,
    null
  );
  var events = JSON.parse(ObjC.unwrap(nsData));

  var app = Application("Calendar");
  app.includeStandardAdditions = true;

  var targetCal = null;
  var cals = app.calendars();
  for (var i = 0; i < cals.length; i++) {
    if (cals[i].name() === calName) {
      targetCal = cals[i];
      break;
    }
  }
  if (!targetCal) {
    return JSON.stringify({ error: "Calendar not found: " + calName });
  }

  var existingStarts = [];
  try {
    var existingEvents = targetCal.events();
    for (var k = 0; k < existingEvents.length; k++) {
      existingStarts.push(existingEvents[k].startDate().getTime());
    }
  } catch (e) {
    // "Add-only" access cannot read existing events. Skip de-dup; still create.
    existingStarts = [];
  }

  var created = 0;
  var skipped = 0;
  var failed = [];
  var createdStarts = [];

  for (var j = 0; j < events.length; j++) {
    var ev = events[j];
    var isDup = false;
    for (var m = 0; m < existingStarts.length; m++) {
      if (Math.abs(existingStarts[m] - ev.start) < 5 * 60 * 1000) {
        isDup = true;
        break;
      }
    }
    if (isDup) {
      skipped++;
      continue;
    }

    try {
      var newEvent = app.Event({
        summary: ev.title,
        startDate: new Date(ev.start),
        endDate: new Date(ev.end),
        description: ev.notes,
      });
      targetCal.events.push(newEvent);
      created++;
      createdStarts.push(ev.start);
    } catch (err) {
      failed.push({ title: ev.title, start: ev.start, error: String(err) });
    }
  }

  return JSON.stringify({
    created: created,
    skipped: skipped,
    failed: failed,
    total: events.length,
    createdStarts: createdStarts,
  });
}
