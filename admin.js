import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir } from 'fs/promises';
import util from 'util';

import { readFileSync, unlink, appendFileSync, readFile, writeFileSync, createWriteStream } from 'fs';
const __dirname = dirname(fileURLToPath(import.meta.url));

// Log function
var log_file = createWriteStream('./debug.log', { flags: 'a' });
var log_stdout = process.stdout;

export function logToFile(d) {
    var now = new Date();
    var datetime = now.toLocaleString();
    log_file.write(datetime + ' ' + util.format(d) + '\n');
    log_stdout.write(util.format(d) + '\n');
}

export async function getAdminData(data, callback) {
    try {
        const result = await checkFilesInDirectory();
        callback({ message: "success", status: "success", resData: { res: result, apikey: "8534d3404bf0422780fb2fe434bf835d"} });
    } catch (err) {
        logToFile(err);
        callback({ message: "failure", status: "failure" });
    }
}

async function checkFilesInDirectory() {
    try {
        let jsonData = await readJSONFile();

        // Read files from the './files/' directory
        const filesInDirectory = await readdir(join(__dirname, '/files/'));

        // Create a result array to store only files found in the directory
        const result = [];

        // Check each entry in the jsonData against the files in the directory
        jsonData.forEach(item => {
            if (filesInDirectory.includes(item.id)) {
                // If the file exists in the directory, add the item to the result array
                result.push(item);
            }
        });

        return result;
    } catch (error) {
        console.error('Error reading directory:', error);
    }
}

async function readJSONFile() {
    try {
        const data = await readFileSync('./data.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading JSON file:', error);
        return [];
    }
}

export async function deleteFile(data, callback) {
    try {
        const filename = data.id;
        const filePath = join(__dirname, '/files/', filename);
        logToFile(`Deleting file: ${filePath}, requested by ${data.ip}`)
        unlink(filePath, (err) => {
            if (err) callback({ message: "failure", status: "failure" });
            logToFile(`${filePath} deleted successfully.`);
        }); callback({ message: "success", status: 200 });
    }
    catch {
        callback({ message: "failure", status: "failure" });
    }

}



export function preserveFile(data, callback) {
    //add file to preserve.txt
    let preserveFilePath = join(__dirname, '/preserve.txt');
    //if preserve.txt does not contain data, then append
    if (!readFileSync(preserveFilePath, 'utf8').includes(data.id)) {
        appendFileSync(preserveFilePath, data.id + "\n");
    } else {
        callback({ message: "File already exists in preserve.", status: 409 });
    }
    logToFile(`File ${data.id} preserved, requested by ${data.ip}`);

    callback({ status: 200 })
};

export async function deletePreserve(data, callback) {
    //find data in preserve.txt, and remove it
    try {
        let preserveFilePath = join(__dirname, '/preserve.txt');
        let lines = readFileSync(preserveFilePath, 'utf8').split('\n');
        let index = lines.indexOf(data.id);
        if (index !== -1) {
            lines.splice(index, 1);
            writeFileSync(preserveFilePath, lines.join('\n'));
        }
        logToFile(`File ${data.id} deleted from preserve, requested by ${data.ip}`);
        callback({ status: 200 })
    }
    catch (err) {
        callback({ message: "failure", status: 500 });
    }

}