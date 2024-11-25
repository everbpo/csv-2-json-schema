import fs from 'fs';
import path from 'path';
import ignore from 'ignore';

export default class SchemaConstructor {
    absPath = '';
    schema = {};
    schemaToBuild = '';
    relativeFiles = [];
    ignoreFilter = ignore();

    constructor(absPath) {
        if (absPath && fs.existsSync(absPath)) {
            this.absPath = absPath;

            // Always ignore .git directory
            this.ignoreFilter.add([
                '.git/**',
                '.git/',
                '.git'
            ]);

            // Add patterns from .gitignore if it exists
            const gitignorePath = path.join(absPath, '.gitignore');
            if (fs.existsSync(gitignorePath)) {
                const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
                this.ignoreFilter.add(gitignoreContent);
            }
        } else {
            throw new Error('Invalid Path');
        }
    }

    build(schemaToBuild = '') {
        if (!schemaToBuild) {
            return 'No Schema to Build';
        }

        // Initialize schema
        this.schemaToBuild = schemaToBuild;
        this.schema = {
            "$schema": "http://json-schema.org/draft-07/schema#"
        };

        // Get all files
        this.readAllFilesFromMainDir();

        // Find schema file
        const schemaFile = this.relativeFiles.find(file => file.endsWith(schemaToBuild));
        if (!schemaFile) {
            throw new Error(`Schema file ${schemaToBuild} not found`);
        }

        // Build schema
        this.buildSchema(schemaFile);
        return this.schema;
    }

    readAllFilesFromMainDir(currentDir = this.absPath) {
        const files = fs.readdirSync(currentDir);

        for (const file of files) {
            const fullPath = path.join(currentDir, file);
            const relativePath = path.relative(this.absPath, fullPath).replace(/\\/g, '/');

            if (this.ignoreFilter.ignores(relativePath)) {
                continue;
            }

            const stats = fs.statSync(fullPath);
            if (stats.isDirectory()) {
                this.readAllFilesFromMainDir(fullPath);
            } else {
                this.relativeFiles.push(relativePath);
            }
        }

        return this.relativeFiles;
    }

    readCSVFile(relativeFile) {
        try {
            const fullPath = path.resolve(this.absPath, relativeFile);
            if (!fs.existsSync(fullPath)) {
                throw new Error(`File not found: ${fullPath}`);
            }
            console.log(fullPath);


            const data = fs.readFileSync(fullPath, 'utf8');
            const rows = data.trim().split('\n');

            // Parse headers
            const headers = rows[0].split(',')
                .map(header => header.trim())
                .map(header => header.replace(/ /g, '_'))
                .map(header => header.toLowerCase());

            // Parse data rows
            return rows.slice(1).map(row => {
                const values = row.split(',').map(v => v.trim());
                return headers.reduce((obj, header, i) => {
                    obj[header] = values[i] || '';
                    return obj;
                }, {});
            });
        } catch (error) {
            console.error(`Error reading CSV file: ${error.message}`);
            throw error;
        }
    }

    buildSchema(schemaFile) {
        const csvData = this.readCSVFile(schemaFile);
        const properties = {
            $schema: "http://json-schema.org/draft-07/schema#",
        };

        // Build properties from CSV data
        for (const row of csvData) {
            let property = '';
            for (const [key, value] of Object.entries(row)) {
                if (!value) continue;
                //Switch cases Name,Type,Min,Max,Required,Repeat,Notes
                switch (key) {
                    case 'name':
                        property = value.trim().replace(/ /g, '_').toLowerCase();
                        properties[property] = {};
                        break;
                    case 'type':
                        const type = value.trim().toLowerCase();
                        if (type === 'number') {
                            properties[property].type = 'number';
                        } else if (type === 'text') {
                            properties[property].type = 'text';
                        } else
                            properties[property] = this.addSubSchema(value.trim().toLowerCase());
                        break;
                    case 'min':
                        properties[property].minLength = value.trim();
                        break;
                    case 'max':
                        properties[property].maxLength = value.trim();
                        break;
                    case 'required':
                        properties[property].required = value.trim();
                        break;
                    case 'repeat':
                        properties[property].repeat = value.trim();
                        break;
                    case 'notes':
                        properties[property].description = value.trim();
                        break;
                    default:
                        break;
                }
            }
        }

        this.schema.properties = properties;

    }
    addSubSchema(type) {
        // Find CSV file for this type
        const pathCSV = this.relativeFiles.find(file =>
            file.toLowerCase().includes(type.toLowerCase())
        );

        if (!pathCSV) {
            console.error(`CSV file for type ${type} not found`);
            return { type: 'string' }; // Default fallback
        }

        // Check if this is a Catalog type
        if (pathCSV.includes('Catalog/')) {
            const catalogData = this.readCSVFile(pathCSV);
            return {
                type: 'string',
                enum: catalogData
                    .filter(row => row.value) // Filter out empty values
                    .map(row => row.value.trim())
            };
        }

        // Handle Model type
        const csvData = this.readCSVFile(pathCSV);
        const subSchema = {
            type: 'object',
            properties: {}
        };

        for (const row of csvData) {
            if (!row.name) continue;

            const propertyName = row.name.trim().replace(/ /g, '_').toLowerCase();
            subSchema.properties[propertyName] = {};

            if (row.type) {
                const propertyType = row.type.trim().toLowerCase();
                if (propertyType === 'number') {
                    subSchema.properties[propertyName].type = 'number';
                } else if (propertyType === 'text') {
                    subSchema.properties[propertyName].type = 'string';
                } else if (['mode', 'crew'].includes(propertyType)) {
                    // Handle nested types recursively
                    subSchema.properties[propertyName] = this.addSubSchema(propertyType);
                }
            }

            if (row.min) subSchema.properties[propertyName].minLength = parseInt(row.min);
            if (row.max) subSchema.properties[propertyName].maxLength = parseInt(row.max);
            if (row.required === 'Y') {
                if (!subSchema.required) subSchema.required = [];
                subSchema.required.push(propertyName);
            }
            if (row.notes) subSchema.properties[propertyName].description = row.notes;
        }

        return subSchema;
    }
}