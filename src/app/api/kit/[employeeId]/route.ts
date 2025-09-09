
import { NextRequest, NextResponse } from 'next/server';
import { firestoreAdmin, storageAdmin } from '@/lib/firebaseAdmin';
import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { format } from 'date-fns';
import QRCode from 'qrcode';

// Helper function to fetch image bytes from Firebase Storage
async function fetchImageBytes(filePath: string | undefined): Promise<Uint8Array | null> {
    if (!filePath) return null;
    try {
        const bucket = storageAdmin.bucket();
        // Extract the path from the full gs:// or https:// URL if necessary
        const path = new URL(filePath).pathname.split('/').slice(3).join('/');
        const file = bucket.file(path);
        const [buffer] = await file.download();
        return new Uint8Array(buffer);
    } catch (error) {
        console.warn(`Could not fetch image at path: ${filePath}`, error);
        return null; // Return null instead of throwing to allow PDF to generate without the image
    }
}

// Helper to draw text and handle wrapping
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
        return currentY + lineHeight; // Return Y of the start of the last line
    } else {
        page.drawText(text, { x, y: currentY, font, size, color });
        return currentY;
    }
}

// Main GET handler for the API route
export async function GET(req: NextRequest, { params }: { params: { employeeId: string } }) {
    const { employeeId } = params;

    if (!employeeId) {
        return new NextResponse('Employee ID is required', { status: 400 });
    }

    try {
        const employeeDoc = await firestoreAdmin.collection('employees').doc(employeeId).get();

        if (!employeeDoc.exists) {
            return new NextResponse('Employee not found', { status: 404 });
        }
        const employeeData = employeeDoc.data() as any;

        // Create a new PDF document
        const pdfDoc = await PDFDocument.create();
        const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
        const timesRomanBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

        // --- PAGE 1: BIODATA ---
        let page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const margin = 50;

        // Title
        await drawText(page, 'Employee Profile Kit', { x: margin, y: height - margin, font: timesRomanBoldFont, size: 24 });

        // Profile Picture
        const profilePicBytes = await fetchImageBytes(employeeData.profilePictureUrl);
        if (profilePicBytes) {
            const image = await pdfDoc.embedPng(profilePicBytes);
            const aspectRatio = image.width / image.height;
            const imageWidth = 100;
            const imageHeight = imageWidth / aspectRatio;
            page.drawImage(image, { x: width - margin - imageWidth, y: height - margin - imageHeight, width: imageWidth, height: imageHeight });
        }
        
        let currentY = height - margin - 30;

        // Basic Info
        await drawText(page, employeeData.fullName, { x: margin, y: currentY, font: timesRomanBoldFont, size: 20 });
        currentY -= 25;
        await drawText(page, `Employee ID: ${employeeData.employeeId}`, { x: margin, y: currentY, font: timesRomanFont, size: 12 });
        currentY -= 15;
        await drawText(page, `Client: ${employeeData.clientName}`, { x: margin, y: currentY, font: timesRomanFont, size: 12 });
        currentY -= 30;

        // Personal Details
        await drawText(page, 'Personal Details', { x: margin, y: currentY, font: timesRomanBoldFont, size: 14 });
        currentY -= 20;
        await drawText(page, `Date of Birth: ${format(employeeData.dateOfBirth.toDate(), 'dd-MM-yyyy')}`, { x: margin, y: currentY, font: timesRomanFont, size: 11 });
        currentY -= 15;
        await drawText(page, `Phone: ${employeeData.phoneNumber}`, { x: margin, y: currentY, font: timesRomanFont, size: 11 });
        currentY -= 15;
        await drawText(page, `Email: ${employeeData.emailAddress}`, { x: margin, y: currentY, font: timesRomanFont, size: 11 });
        currentY -= 15;
        await drawText(page, `Address: ${employeeData.fullAddress}`, { x: margin, y: currentY, font: timesRomanFont, size: 11, maxWidth: width / 2 - margin });
        currentY -= 40;

        // Identification
        await drawText(page, 'Identification', { x: margin, y: currentY, font: timesRomanBoldFont, size: 14 });
        currentY -= 20;
        const panMasked = `******${employeeData.panNumber?.slice(-4)}`;
        await drawText(page, `PAN: ${panMasked}`, { x: margin, y: currentY, font: timesRomanFont, size: 11 });
        currentY -= 15;
        const idProofMasked = `******${employeeData.identityProofNumber?.slice(-4)}`;
        await drawText(page, `${employeeData.identityProofType}: ${idProofMasked}`, { x: margin, y: currentY, font: timesRomanFont, size: 11 });
        
        // QR Code
        const qrDataURL = await QRCode.toDataURL(`${req.nextUrl.origin}/profile/${employeeId}`);
        const qrBytes = Buffer.from(qrDataURL.split(',')[1], 'base64');
        const qrImage = await pdfDoc.embedPng(qrBytes);
        page.drawImage(qrImage, { x: width - margin - 120, y: margin, width: 120, height: 120 });


        // --- Add Document Pages ---
        const documents = [
            { title: 'Identity Proof (Front)', url: employeeData.identityProofUrlFront || employeeData.idProofDocumentUrlFront },
            { title: 'Identity Proof (Back)', url: employeeData.identityProofUrlBack || employeeData.idProofDocumentUrlBack },
            { title: 'Address Proof (Front)', url: employeeData.addressProofUrlFront },
            { title: 'Address Proof (Back)', url: employeeData.addressProofUrlBack },
            { title: 'Signature', url: employeeData.signatureUrl },
            { title: 'Bank Passbook/Statement', url: employeeData.bankPassbookStatementUrl },
        ];

        for (const doc of documents) {
            if (doc.url) {
                const imageBytes = await fetchImageBytes(doc.url);
                if (imageBytes) {
                    page = pdfDoc.addPage();
                    let image;
                    try {
                        image = await pdfDoc.embedJpg(imageBytes);
                    } catch {
                        try {
                           image = await pdfDoc.embedPng(imageBytes);
                        } catch (e) {
                             console.warn(`Could not embed image for ${doc.title}`);
                             continue;
                        }
                    }
                   
                    await drawText(page, doc.title, { x: margin, y: height - margin, font: timesRomanBoldFont, size: 18 });
                    const scale = 0.8;
                    const imgWidth = page.getWidth() * scale;
                    const imgHeight = page.getHeight() * scale;
                    const aspectRatio = image.width / image.height;
                    let finalWidth = imgWidth;
                    let finalHeight = finalWidth / aspectRatio;

                    if (finalHeight > imgHeight) {
                        finalHeight = imgHeight;
                        finalWidth = finalHeight * aspectRatio;
                    }
                    
                    const xPos = (page.getWidth() - finalWidth) / 2;
                    const yPos = (page.getHeight() - finalHeight) / 2;

                    page.drawImage(image, { x: xPos, y: yPos, width: finalWidth, height: finalHeight });
                }
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
        console.error('PDF Generation Error:', error);
        return new NextResponse('Failed to generate PDF kit', { status: 500 });
    }
}
