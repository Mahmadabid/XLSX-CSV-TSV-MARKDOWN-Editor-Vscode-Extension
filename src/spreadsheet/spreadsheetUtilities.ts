import * as Excel from 'exceljs';
import * as JSZip from 'jszip';
import * as fs from 'fs';

export function convertARGBToRGBA(argb: string): string {
    if (!argb || argb.length !== 8) {
        return 'rgba(0, 0, 0, 1)';
    }
    
    const a = parseInt(argb.substring(0, 2), 16) / 255;
    const r = parseInt(argb.substring(2, 4), 16);
    const g = parseInt(argb.substring(4, 6), 16);
    const b = parseInt(argb.substring(6, 8), 16);
    
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function isShadeOfBlack(color: string): boolean {
    // Parse RGB/RGBA values
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (!match) return false;
    
    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);
    
    // Consider a color as "shade of black" only if ALL RGB values are very low
    // The color #c9daf8 = rgb(201, 218, 248) should NOT be considered black
    const threshold = 50; // Very dark colors only
    
    // ALL components must be below threshold to be considered "black"
    return r <= threshold && g <= threshold && b <= threshold;
}

export function isShadeOfWhite(color: string): boolean {
    // Parse RGB/RGBA values
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (!match) return false;

    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    // Consider a color as "shade of white" if ALL RGB values are very high
    const threshold = 240; // Very light colors only

    return r >= threshold && g >= threshold && b >= threshold;
}

export function sanitizeSpreadsheetXml(xml: string): string {
    if (typeof xml !== 'string' || !xml) {
        return xml;
    }

    // Detect namespace prefixes bound to SpreadsheetML or OpenXML package relationships
    const targetNamespaceRegex = /xmlns:([a-zA-Z0-9_\-]+)=["'](http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/spreadsheetml\/main|http:\/\/schemas\.openxmlformats\.org\/package\/2006\/relationships)["']/g;
    let match: RegExpExecArray | null;
    const prefixes: Array<{ prefix: string; fullDecl: string; url: string }> = [];
    while ((match = targetNamespaceRegex.exec(xml)) !== null) {
        prefixes.push({ prefix: match[1], fullDecl: match[0], url: match[2] });
    }

    if (prefixes.length === 0) {
        return xml;
    }

    let sanitized = xml;
    for (const { prefix, fullDecl, url } of prefixes) {
        // Strip prefix from opening tags: <prefix:tag -> <tag
        const openTagRegex = new RegExp(`<${prefix}:([a-zA-Z0-9_]+)`, 'g');
        sanitized = sanitized.replace(openTagRegex, '<$1');

        // Strip prefix from closing tags: </prefix:tag> -> </tag>
        const closeTagRegex = new RegExp(`</${prefix}:([a-zA-Z0-9_]+)>`, 'g');
        sanitized = sanitized.replace(closeTagRegex, '</$1>');

        // If default xmlns is not present and this is spreadsheetml/relationships, promote it to default xmlns
        if (!sanitized.includes('xmlns=')) {
            sanitized = sanitized.replace(fullDecl, `xmlns="${url}"`);
        } else {
            sanitized = sanitized.replace(fullDecl, '');
        }
    }
    return sanitized;
}

export async function sanitizeXlsxBuffer(fileBuffer: Buffer): Promise<Buffer | null> {
    const zip = await JSZip.loadAsync(fileBuffer);
    let modified = false;

    for (const [entryPath, zipEntry] of Object.entries(zip.files)) {
        if (!zipEntry.dir && (entryPath.endsWith('.xml') || entryPath.endsWith('.rels'))) {
            const xmlContent = await zipEntry.async('string');
            const sanitized = sanitizeSpreadsheetXml(xmlContent);
            if (sanitized !== xmlContent) {
                zip.file(entryPath, sanitized);
                modified = true;
            }
        }
    }

    if (!modified) {
        return null;
    }

    return await zip.generateAsync({ type: 'nodebuffer' });
}

export async function loadExcelWorkbook(
    filePathOrBuffer: string | Buffer,
    targetWorkbook?: Excel.Workbook
): Promise<Excel.Workbook> {
    const workbook = targetWorkbook || new Excel.Workbook();

    if (typeof filePathOrBuffer === 'string') {
        try {
            await workbook.xlsx.readFile(filePathOrBuffer);
            return workbook;
        } catch (initialError) {
            // Attempt recovery by reading file buffer and sanitizing XML namespaces
            const fileBuffer = await fs.promises.readFile(filePathOrBuffer);
            const sanitizedBuffer = await sanitizeXlsxBuffer(fileBuffer);
            if (!sanitizedBuffer) {
                throw initialError;
            }
            await workbook.xlsx.load(sanitizedBuffer);
            return workbook;
        }
    } else {
        try {
            await workbook.xlsx.load(filePathOrBuffer);
            return workbook;
        } catch (initialError) {
            const sanitizedBuffer = await sanitizeXlsxBuffer(filePathOrBuffer);
            if (!sanitizedBuffer) {
                throw initialError;
            }
            await workbook.xlsx.load(sanitizedBuffer);
            return workbook;
        }
    }
}

