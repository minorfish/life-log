import { getAllRecords, getTableId, getToken, loadConfig } from "./utils/feishu_life.js";

async function main() {
  const config = loadConfig();
  const token = await getToken(config);
  
  const args = process.argv.slice(2);
  const foods = args.length > 0 ? args : ["玉米", "茯苓膏", "牛奶"];
  console.log("Searching for foods:", foods.join(", "));
  
  const records = await getAllRecords(token, config.appToken, getTableId(config, "foodComp"));
  
  if (records.length > 0) {
    console.log("First record fields:", Object.keys(records[0].fields));
  } else {
    console.log("No records found.");
  }
  
  foods.forEach(foodName => {
    const matches = records.filter((r: any) => r.fields["食物名称"] && typeof r.fields["食物名称"] === "string" && r.fields["食物名称"].includes(foodName));
    console.log(`\nMatches for "${foodName}":`);
    matches.forEach((m: any) => {
      console.log(JSON.stringify(m.fields, null, 2));
    });
  });
}

main();
