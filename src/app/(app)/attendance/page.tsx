
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QrCode, Camera, MapPin, CheckCircle, XCircle, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Image from 'next/image';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';

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
  const [employeePhoto, setEmployeePhoto] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [recentAttendance, setRecentAttendance] = useState<AttendanceRecord[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Mock fetching location - in a real app, use navigator.geolocation
    if (isFetchingLocation) {
      setTimeout(() => {
        setLocation('12.9716° N, 77.5946° E (Mocked)');
        setIsFetchingLocation(false);
        toast({ title: "Location Acquired", description: "Device location captured."});
      }, 1500);
    }
  }, [isFetchingLocation, toast]);

  const handleScanQR = () => {
    setIsScanning(true);
    // Simulate QR scan
    setTimeout(() => {
      const mockEmployeeId = `CISS${Math.floor(100 + Math.random() * 900)}`;
      setScanResult(mockEmployeeId);
      setIsScanning(false);
      toast({ title: "QR Code Scanned", description: `Employee ID: ${mockEmployeeId}`});
      // Automatically trigger photo capture and location fetch
      handleTakePhoto();
      handleFetchLocation();
    }, 2000);
  };

  const handleTakePhoto = async () => {
    setIsTakingPhoto(true);
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            // Simulate taking a picture after a short delay
            setTimeout(() => {
              if (videoRef.current && canvasRef.current) {
                const context = canvasRef.current.getContext('2d');
                canvasRef.current.width = videoRef.current.videoWidth;
                canvasRef.current.height = videoRef.current.videoHeight;
                context?.drawImage(videoRef.current, 0, 0, videoRef.current.videoWidth, videoRef.current.videoHeight);
                const photoDataUrl = canvasRef.current.toDataURL('image/png');
                setEmployeePhoto(photoDataUrl);
                stream.getTracks().forEach(track => track.stop()); // Stop camera
                setIsTakingPhoto(false);
                toast({ title: "Photo Captured", description: "Employee photo taken successfully."});
              }
            }, 1000); // Display camera feed for 1 sec then take photo
          };
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        toast({ variant: "destructive", title: "Camera Error", description: "Could not access camera." });
        setIsTakingPhoto(false);
         // Fallback placeholder if camera fails
        setEmployeePhoto("https://placehold.co/320x240.png?text=Camera+Error");
      }
    } else {
        toast({ variant: "destructive", title: "Camera Not Supported", description: "Your browser does not support camera access." });
        setIsTakingPhoto(false);
        setEmployeePhoto("https://placehold.co/320x240.png?text=No+Camera");
    }
  };

  const handleFetchLocation = () => {
    setIsFetchingLocation(true);
     if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setLocation(`${position.coords.latitude.toFixed(4)}° N, ${position.coords.longitude.toFixed(4)}° E`);
                setIsFetchingLocation(false);
                toast({ title: "Location Acquired", description: "Device location captured." });
            },
            (error) => {
                console.error("Error getting location:", error);
                setLocation('Error fetching location');
                setIsFetchingLocation(false);
                toast({ variant: "destructive", title: "Location Error", description: "Could not fetch device location." });
            }
        );
    } else {
        setLocation('Geolocation not supported');
        setIsFetchingLocation(false);
        toast({ variant: "destructive", title: "Location Not Supported", description: "Geolocation is not supported by this browser." });
    }
  };

  const handleMarkAttendance = (status: 'In' | 'Out') => {
    if (!scanResult) {
      toast({ variant: "destructive", title: "QR Not Scanned", description: "Please scan employee QR code first." });
      return;
    }
    if (!employeePhoto) {
      toast({ variant: "destructive", title: "Photo Not Taken", description: "Please capture employee photo."});
      return;
    }
    if (!location) {
      toast({ variant: "destructive", title: "Location Not Fetched", description: "Please ensure location is captured."});
      return;
    }

    const newRecord: AttendanceRecord = {
      id: Date.now().toString(),
      name: `Employee (ID: ${scanResult})`, // In real app, fetch name
      employeeId: scanResult,
      time: new Date().toLocaleTimeString(),
      status,
      location,
      photoUrl: employeePhoto, // In real app, this would be uploaded URL
    };
    setRecentAttendance(prev => [newRecord, ...prev.slice(0, 4)]);
    toast({
      title: `Attendance Marked ${status}`,
      description: `${newRecord.name} marked ${status.toLowerCase()} at ${newRecord.time}.`,
      action: <CheckCircle className="h-5 w-5 text-green-500" />
    });
    // Reset for next scan
    setScanResult(null);
    setEmployeePhoto(null);
    setLocation(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Attendance Tracking</h1>
      
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Instructions</AlertTitle>
        <AlertDescription>
          1. Click "Scan QR & Verify" to start. This will scan QR, take a photo, and get location.
          2. Once all data is captured, click "Mark IN" or "Mark OUT".
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Mark Attendance</CardTitle>
          <CardDescription>Scan QR code, capture photo and location for verification.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button onClick={handleScanQR} disabled={isScanning || isTakingPhoto || isFetchingLocation} className="w-full sm:w-auto">
            <QrCode className="mr-2 h-4 w-4" /> 
            {isScanning ? "Scanning QR..." : isTakingPhoto ? "Capturing Photo..." : isFetchingLocation ? "Getting Location..." : "Scan QR & Verify"}
          </Button>

          {(isScanning || isTakingPhoto || isFetchingLocation) && (
            <Progress value={isScanning ? 33 : isTakingPhoto ? 66 : isFetchingLocation ? 90 : 0} className="w-full mt-2" />
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col items-center p-4 border rounded-md bg-muted/30">
              <QrCode className={`h-12 w-12 mb-2 ${scanResult ? 'text-green-500' : 'text-muted-foreground'}`} />
              <Label>QR Scan Status</Label>
              {scanResult ? (
                <p className="text-sm text-green-500 flex items-center"><CheckCircle className="mr-1 h-4 w-4" /> Scanned: {scanResult}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Not Scanned</p>
              )}
            </div>

            <div className="flex flex-col items-center p-4 border rounded-md bg-muted/30">
              <Camera className={`h-12 w-12 mb-2 ${employeePhoto ? 'text-green-500' : 'text-muted-foreground'}`} />
              <Label>Photo Status</Label>
              {employeePhoto ? (
                 <div className="mt-2 relative w-32 h-24">
                    <Image src={employeePhoto} alt="Employee photo" layout="fill" objectFit="cover" className="rounded" data-ai-hint="employee attendance photo" />
                 </div>
              ) : isTakingPhoto && videoRef.current ? (
                <div className="mt-2 w-full max-w-xs">
                  <video ref={videoRef} className="w-full h-auto rounded" playsInline muted />
                  <canvas ref={canvasRef} className="hidden" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No Photo</p>
              )}
            </div>

            <div className="flex flex-col items-center p-4 border rounded-md bg-muted/30">
              <MapPin className={`h-12 w-12 mb-2 ${location && !location.startsWith('Error') ? 'text-green-500' : location && location.startsWith('Error') ? 'text-red-500' : 'text-muted-foreground'}`} />
              <Label>Location Status</Label>
              {location ? (
                <p className={`text-sm ${location.startsWith('Error') ? 'text-red-500' : 'text-green-500'} flex items-center`}>
                    {location.startsWith('Error') ? <XCircle className="mr-1 h-4 w-4" /> : <CheckCircle className="mr-1 h-4 w-4" />} 
                    {location}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Not Fetched</p>
              )}
            </div>
          </div>

        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row justify-end gap-2">
          <Button 
            variant="destructive" 
            onClick={() => handleMarkAttendance('Out')} 
            disabled={!scanResult || !employeePhoto || !location || isScanning || isTakingPhoto || isFetchingLocation}
            className="w-full sm:w-auto"
          >
            <XCircle className="mr-2 h-4 w-4" /> Mark OUT
          </Button>
          <Button 
            onClick={() => handleMarkAttendance('In')} 
            disabled={!scanResult || !employeePhoto || !location || isScanning || isTakingPhoto || isFetchingLocation}
            className="w-full sm:w-auto"
          >
            <CheckCircle className="mr-2 h-4 w-4" /> Mark IN
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Attendance Logs</CardTitle>
          <CardDescription>Last 5 attendance records for this device.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentAttendance.length === 0 ? (
            <p className="text-muted-foreground">No recent attendance records.</p>
          ) : (
            <ul className="space-y-3">
              {recentAttendance.map(record => (
                <li key={record.id} className="flex items-center justify-between p-3 border rounded-md shadow-sm">
                  <div className="flex items-center gap-3">
                    {record.photoUrl && <Image src={record.photoUrl} alt={record.name} width={40} height={40} className="rounded-full" data-ai-hint="employee avatar" />}
                    <div>
                      <p className="font-medium">{record.name}</p>
                      <p className="text-sm text-muted-foreground">ID: {record.employeeId} | Time: {record.time}</p>
                      <p className="text-xs text-muted-foreground">Location: {record.location}</p>
                    </div>
                  </div>
                  <Badge variant={record.status === 'In' ? 'default' : 'destructive'}>
                    {record.status === 'In' ? <CheckCircle className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
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
