import SchemaConstructor from "./src/SchemaConstructor.js";

const schemaConstructor = new SchemaConstructor('C:\\Users\\FlexBPO\\Desktop\\cc2-contracts');
const result = schemaConstructor.build('ExportTruck.csv');
console.log(JSON.stringify(result, null, 2));