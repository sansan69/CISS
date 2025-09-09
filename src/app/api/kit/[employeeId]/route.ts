import { NextRequest, NextResponse } from 'next/server';
import { db, bucket } from '@/lib/firebaseAdmin';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { format } from 'date-fns';
import QRCode from 'qrcode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchImageBytes(filePath: string | undefined): Promise<Uint8Array | null> {
    if (!filePath) return null;
    try {
        const url = new URL(filePath);
        // Extracts path from gs:// or https:// URL
        const path = url.protocol === 'gs:' 
            ? url.pathname.substring(1) 
            : decodeURIComponent(url.pathname.split('/o/')[1].split('?')[0]);
            
        const file = bucket.file(path);
        const [buffer] = await file.download();
        return buffer;
    } catch (error) {
        console.warn(`Could not fetch image at path: ${filePath}`, error);
        // Gracefully fail if an image is missing or another error occurs during download
        return null; 
    }
}

async function drawText(page: any, text: string, options: { x: number; y: number; font: any; size: number; maxWidth?: number; color?: any }) {
    if (!text) return options.y;
    
    let currentY = options.y;
    const { x, font, size, maxWidth, color = rgb(0, 0, 0) } = options;
    const lineHeight = size * 1.2;

    if (maxWidth) {
        let lines = [];
        let currentLine = '';
        const words = text.split(' ');
        
        for (const word of words) {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const testWidth = font.widthOfTextAtSize(testLine, size);
            if (testWidth > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine);

        for (const line of lines) {
            page.drawText(line, { x, y: currentY, font, size, color });
            currentY -= lineHeight;
        }
        return currentY;
    } else {
        page.drawText(text, { x, y: currentY, font, size, color });
        return currentY - lineHeight;
    }
}


export async function GET(req: NextRequest, { params }: { params: { employeeId: string } }) {
    const { employeeId } = params;

    if (!employeeId) {
        return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    try {
        const employeeDoc = await db.collection('employees').doc(employeeId).get();

        if (!employeeDoc.exists) {
            return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
        }
        const employeeData = employeeDoc.data() as any;

        const pdfDoc = await PDFDocument.create();
        const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
        const timesRomanBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

        let page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const margin = 50;
        let currentY = height - margin;

        const profilePicBytes = await fetchImageBytes(employeeData.profilePictureUrl);
        if (profilePicBytes) {
            const image = await pdfDoc.embedPng(profilePicBytes);
            page.drawImage(image, { x: width - margin - 100, y: height - margin - 120, width: 100, height: 120 });
        }
        
        await drawText(page, employeeData.fullName, { x: margin, y: currentY, font: timesRomanBoldFont, size: 22 });
        currentY -= 40;

        await drawText(page, `Employee ID: ${employeeData.employeeId}`, { x: margin, y: currentY, font: timesRomanFont, size: 12 });
        currentY -= 15;
        await drawText(page, `Client: ${employeeData.clientName}`, { x: margin, y: currentY, font: timesRomanFont, size: 12 });
        currentY -= 30;
        
        await drawText(page, 'Personal Details', { x: margin, y: currentY, font: timesRomanBoldFont, size: 14 });
        currentY -= 20;
        await drawText(page, `Date of Birth: ${format(employeeData.dateOfBirth.toDate(), 'dd-MM-yyyy')}`, { x: margin, y: currentY, font: timesRomanFont, size: 11 });
        currentY -= 15;
        await drawText(page, `Phone: ${employeeData.phoneNumber}`, { x: margin, y: currentY, font: timesRomanFont, size: 11 });
        currentY -= 15;
        await drawText(page, `Email: ${employeeData.emailAddress}`, { x: margin, y: currentY, font: timesRomanFont, size: 11 });
        currentY -= 15;
        currentY = await drawText(page, `Address: ${employeeData.fullAddress}`, { x: margin, y: currentY, font: timesRomanFont, size: 11, maxWidth: width / 2 - margin });
        currentY -= 30;

        const qrDataURL = await QRCode.toDataURL(`${req.nextUrl.origin}/profile/${employeeId}`);
        const qrBytes = Buffer.from(qrDataURL.split(',')[1], 'base64');
        const qrImage = await pdfDoc.embedPng(qrBytes);
        page.drawImage(qrImage, { x: width - margin - 120, y: margin, width: 120, height: 120 });

        const documents = [
            { title: 'Identity Proof (Front)', url: employeeData.identityProofUrlFront || employeeData.idProofDocumentUrlFront || employeeData.idProofDocumentUrl },
            { title: 'Identity Proof (Back)', url: employeeData.identityProofUrlBack || employeeData.idProofDocumentUrlBack },
            { title: 'Address Proof (Front)', url: employeeData.addressProofUrlFront },
            { title: 'Address Proof (Back)', url: employeeData.addressProofUrlBack },
            { title: 'Signature', url: employeeData.signatureUrl },
            { title: 'Bank Passbook/Statement', url: employeeData.bankPassbookStatementUrl },
        ];

        for (const doc of documents) {
            if (!doc.url) continue;
            const imageBytes = await fetchImageBytes(doc.url);
            if (imageBytes) {
                page = pdfDoc.addPage();
                let image;
                try { image = await pdfDoc.embedJpg(imageBytes); } catch {
                    try { image = await pdfDoc.embedPng(imageBytes); } catch (e) {
                         console.warn(`Could not embed image for ${doc.title}`); continue;
                    }
                }
                const scale = 0.85;
                const imgWidth = page.getWidth() * scale;
                const imgHeight = page.getHeight() * scale;
                const aspectRatio = image.width / image.height;
                let finalWidth = imgWidth;
                let finalHeight = finalWidth / aspectRatio;
                if (finalHeight > imgHeight) { finalHeight = imgHeight; finalWidth = finalHeight * aspectRatio; }
                page.drawImage(image, { x: (page.getWidth() - finalWidth) / 2, y: (page.getHeight() - finalHeight) / 2, width: finalWidth, height: finalHeight });
            }
        }

        const pdfBytes = await pdfDoc.save();

        return new NextResponse(pdfBytes, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="CISS_ProfileKit_${employeeData.employeeId}.pdf"`,
            },
        });

    } catch (error: any) {
        console.error('PDF Generation API Error:', error);
        return new NextResponse(JSON.stringify({ error: 'Failed to generate PDF kit.', details: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
