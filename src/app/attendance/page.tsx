
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, Camera, MapPin, CheckCircle, XCircle, Info, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Image from 'next/image';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import html2canvas from 'html2canvas';

interface AttendanceRecord {
  id: string;
  name: string;
  employeeId: string;
  time: string;
  status: 'In' | 'Out';
  location?: string;
  photoUrl?: string;
}

export default function AttendancePage() {
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [watermarkedPhoto, setWatermarkedPhoto] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lon: number } | null>(null);
  
  const [isScanning, setIsScanning] = useState(false);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [isWatermarking, setIsWatermarking] = useState(false);

  const [recentAttendance, setRecentAttendance] = useState<AttendanceRecord[]>([]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoContainerRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();

  const allVerificationsComplete = !!watermarkedPhoto && !!location && !!scanResult;

  const handleStartVerification = async () => {
    setIsFetchingLocation(true);
    setIsTakingPhoto(true);

    try {
      await Promise.all([
        getDeviceLocation(),
        startCameraStream()
      ]);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Verification Error", description: error.message });
      resetState();
    }
  };

  const getDeviceLocation = () => new Promise<void>((resolve, reject) => {
    if (!navigator.geolocation) {
      setIsFetchingLocation(false);
      return reject(new Error("Geolocation is not supported by this browser."));
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocationCoords({ lat: latitude, lon: longitude });
        // Using a reverse geocoding API would be ideal here. For now, just show coords.
        setLocation(`Lat: ${latitude.toFixed(4)}, Lon: ${longitude.toFixed(4)}`);
        setIsFetchingLocation(false);
        toast({ title: "Location Acquired", description: "Device location captured." });
        resolve();
      },
      (error) => {
        console.error("Error getting location:", error);
        setLocation('Error: Could not fetch');
        setIsFetchingLocation(false);
        reject(new Error("Could not fetch device location. Please enable location services."));
      }
    );
  });
  
  const startCameraStream = () => new Promise<void>((resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setIsTakingPhoto(false);
      return reject(new Error("Camera is not supported by your browser."));
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
      .then(stream => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            resolve();
          };
        }
      })
      .catch(err => {
        console.error("Error accessing camera:", err);
        setIsTakingPhoto(false);
        reject(new Error("Could not access camera. Please enable camera permissions."));
      });
  });

  const handleScanAndCapture = () => {
    setIsScanning(true);
    // 1. Simulate QR scan
    setTimeout(() => {
      const mockEmployeeId = `CISS${Math.floor(100 + Math.random() * 900)}`;
      setScanResult(mockEmployeeId);
      toast({ title: "QR Code Scanned", description: `Employee ID: ${mockEmployeeId}`});
      
      // 2. Capture photo from video stream
      if (videoRef.current) {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const photoDataUrl = canvas.toDataURL('image/jpeg');
        setCapturedPhoto(photoDataUrl);
        toast({ title: "Photo Captured" });
        
        // Stop camera after capture
        const stream = videoRef.current.srcObject as MediaStream;
        stream?.getTracks().forEach(track => track.stop());
        setIsTakingPhoto(false);
      }
      setIsScanning(false);
    }, 1500); // Simulate scan delay
  };
  
  // Watermark photo when capturedPhoto is set
  useEffect(() => {
    const generateWatermarkedPhoto = async () => {
      if (capturedPhoto && location && photoContainerRef.current) {
        setIsWatermarking(true);
        try {
          const canvas = await html2canvas(photoContainerRef.current, {
              useCORS: true,
              backgroundColor: null, // Make background transparent
          });
          setWatermarkedPhoto(canvas.toDataURL('image/png'));
          toast({ title: "Verification Complete", description: "Photo watermarked and verified." });
        } catch (error) {
            console.error("Error generating watermarked photo:", error);
            toast({ variant: "destructive", title: "Error", description: "Could not apply watermark to photo." });
        } finally {
            setIsWatermarking(false);
        }
      }
    };
    generateWatermarkedPhoto();
  }, [capturedPhoto, location, toast]);

  const handleMarkAttendance = (status: 'In' | 'Out') => {
    if (!allVerificationsComplete) return;

    const newRecord: AttendanceRecord = {
      id: Date.now().toString(),
      name: `Employee (ID: ${scanResult})`, // In real app, fetch name
      employeeId: scanResult!,
      time: new Date().toLocaleTimeString(),
      status,
      location: location!,
      photoUrl: watermarkedPhoto!, // Use the watermarked photo
    };
    setRecentAttendance(prev => [newRecord, ...prev.slice(0, 4)]);
    toast({
      title: `Attendance Marked ${status}`,
      description: `${newRecord.name} marked ${status.toLowerCase()} at ${newRecord.time}.`,
      action: <CheckCircle className="h-5 w-5 text-green-500" />
    });
    
    resetState();
  };

  const resetState = () => {
      setScanResult(null);
      setCapturedPhoto(null);
      setWatermarkedPhoto(null);
      setLocation(null);
      setLocationCoords(null);
      setIsScanning(false);
      setIsTakingPhoto(false);
      setIsFetchingLocation(false);
      setIsWatermarking(false);
  }

  const isLoading = isFetchingLocation || isTakingPhoto || isScanning || isWatermarking;
  const verificationStarted = isFetchingLocation || isTakingPhoto;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="text-3xl font-bold tracking-tight">Attendance Tracking</h1>
      
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>How to Mark Attendance</AlertTitle>
        <AlertDescription>
          {!verificationStarted && 'Click "Start Verification" to access your camera and location.'}
          {verificationStarted && !scanResult && 'Point your QR code at the camera and click "Scan QR & Capture".'}
          {scanResult && 'Once all data is captured, click "Mark IN" or "Mark OUT".'}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Attendance Terminal</CardTitle>
          <CardDescription>Verify your identity to mark attendance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!verificationStarted ? (
            <Button onClick={handleStartVerification} className="w-full sm:w-auto">
              <Camera className="mr-2 h-4 w-4" /> Start Verification
            </Button>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Side: Camera and Capture */}
              <div className="space-y-4">
                 <div ref={photoContainerRef} className="relative w-full aspect-[4/3] bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                    {isTakingPhoto && <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />}
                    {capturedPhoto && <Image src={capturedPhoto} alt="Captured photo" layout="fill" objectFit="cover" data-ai-hint="employee attendance photo"/>}
                    {(capturedPhoto && location) && (
                       <div className="absolute bottom-0 left-0 w-full bg-black/50 text-white p-2 text-xs">
                          <p>{new Date().toLocaleString()}</p>
                          <p>{location}</p>
                       </div>
                    )}
                    {isWatermarking && (
                        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <p className="mt-2">Verifying...</p>
                        </div>
                    )}
                 </div>
                 <Button onClick={handleScanAndCapture} disabled={isLoading || !!scanResult} className="w-full">
                    <QrCode className="mr-2 h-4 w-4" /> 
                    {isScanning ? "Scanning..." : "Scan QR & Capture Photo"}
                 </Button>
              </div>
              
              {/* Right Side: Status */}
              <div className="space-y-4">
                 <h3 className="font-semibold text-lg">Verification Status</h3>
                 <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 border rounded-md">
                        <Camera className={`h-6 w-6 ${capturedPhoto ? 'text-green-500' : 'text-muted-foreground'}`} />
                        <div>
                            <p className="font-medium">Photo</p>
                            <p className={`text-sm ${capturedPhoto ? 'text-green-500' : 'text-muted-foreground'}`}>{capturedPhoto ? 'Captured' : 'Pending'}</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-3 p-3 border rounded-md">
                        <MapPin className={`h-6 w-6 ${location ? 'text-green-500' : 'text-muted-foreground'}`} />
                        <div>
                            <p className="font-medium">Location</p>
                            <p className={`text-sm ${location ? 'text-green-500' : 'text-muted-foreground'}`}>{location || 'Pending'}</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-3 p-3 border rounded-md">
                        <QrCode className={`h-6 w-6 ${scanResult ? 'text-green-500' : 'text-muted-foreground'}`} />
                        <div>
                            <p className="font-medium">QR Scan</p>
                            <p className={`text-sm ${scanResult ? 'text-green-500' : 'text-muted-foreground'}`}>{scanResult || 'Pending'}</p>
                        </div>
                    </div>
                 </div>
                 {watermarkedPhoto && (
                    <div className="mt-4">
                        <p className="font-semibold mb-2">Verified Photo:</p>
                        <Image src={watermarkedPhoto} alt="Watermarked employee photo" width={200} height={150} className="rounded-md border" data-ai-hint="verified employee photo"/>
                    </div>
                 )}
              </div>
            </div>
          )}
          
          {isLoading && (
            <Progress value={isFetchingLocation ? 20 : isTakingPhoto ? 40 : isScanning ? 60 : isWatermarking ? 80 : 0} className="w-full mt-2" />
          )}

        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row justify-end gap-2">
          <Button 
            variant="destructive" 
            onClick={() => handleMarkAttendance('Out')} 
            disabled={!allVerificationsComplete || isLoading}
            className="w-full sm:w-auto"
          >
            <XCircle className="mr-2 h-4 w-4" /> Mark OUT
          </Button>
          <Button 
            onClick={() => handleMarkAttendance('In')} 
            disabled={!allVerificationsComplete || isLoading}
            className="w-full sm:w-auto"
          >
            <CheckCircle className="mr-2 h-4 w-4" /> Mark IN
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Attendance Logs (This Device)</CardTitle>
          <CardDescription>Last 5 attendance records marked on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentAttendance.length === 0 ? (
            <p className="text-muted-foreground">No recent attendance records.</p>
          ) : (
            <ul className="space-y-3">
              {recentAttendance.map(record => (
                <li key={record.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border rounded-md shadow-sm gap-4">
                  <div className="flex items-center gap-3">
                    {record.photoUrl && <Image src={record.photoUrl} alt={record.name} width={80} height={60} className="rounded-md" data-ai-hint="employee avatar" />}
                    <div>
                      <p className="font-medium">{record.name}</p>
                      <p className="text-sm text-muted-foreground">ID: {record.employeeId} | Time: {record.time}</p>
                      <p className="text-xs text-muted-foreground">Location: {record.location}</p>
                    </div>
                  </div>
                  <Badge variant={record.status === 'In' ? 'default' : 'destructive'} className="shrink-0">
                    {record.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
