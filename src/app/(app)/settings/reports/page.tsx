
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarChart3, Download, CalendarIcon, AlertCircle, CheckCircle, Loader2, Filter } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format, subDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { useToast } from '@/hooks/use-toast';
import { mockEmployees } from '@/types/employee'; // For department list

export default function ReportsPage() {
  const [reportType, setReportType] = useState<string>("daily_summary");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [exportFormat, setExportFormat] = useState<string>("xlsx");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');

  const { toast } = useToast();

  const uniqueDepartments = React.useMemo(() => {
    const departments = new Set(mockEmployees.map(emp => emp.department).filter(Boolean) as string[]);
    return ['all', ...Array.from(departments)];
  }, []);

  const handleGenerateReport = async () => {
    if (!dateRange?.from || !dateRange?.to) {
      toast({ variant: "destructive", title: "Date Range Required", description: "Please select a valid date range." });
      return;
    }

    setIsGenerating(true);
    setGenerationStatus('generating');

    // Simulate report generation
    setTimeout(() => {
      setIsGenerating(false);
      const success = Math.random() > 0.1; // 90% success rate
      if (success) {
        setGenerationStatus('success');
        toast({ title: "Report Generated", description: `Your ${reportType.replace(/_/g, ' ')} report is ready for download.` });
        // In a real app, trigger download here:
        // window.location.href = `/api/reports/download?type=${reportType}&from=${dateRange.from?.toISOString()}&to=${dateRange.to?.toISOString()}&department=${selectedDepartment}&format=${exportFormat}`;
      } else {
        setGenerationStatus('error');
        toast({ variant: "destructive", title: "Report Generation Failed", description: "An error occurred while generating the report. Please try again." });
      }
    }, 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Attendance Reports</h1>
      
      <Alert>
        <BarChart3 className="h-4 w-4" />
        <AlertTitle>Report Generation</AlertTitle>
        <AlertDescription>
          Select report type, date range, and other filters to generate detailed attendance reports. Reports can be exported in various formats.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Generate New Report</CardTitle>
          <CardDescription>Configure and generate your attendance report.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="report-type">Report Type</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger id="report-type">
                <SelectValue placeholder="Select report type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily_summary">Daily Summary</SelectItem>
                <SelectItem value="monthly_attendance">Monthly Attendance</SelectItem>
                <SelectItem value="late_comers_report">Late Comers Report</SelectItem>
                <SelectItem value="absentee_report">Absentee Report</SelectItem>
                <SelectItem value="employee_wise_log">Employee-wise Log</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date-range">Date Range</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date-range"
                  variant={"outline"}
                  className="w-full justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd, y")} -{" "}
                        {format(dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="department-filter">Department</Label>
             <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
              <SelectTrigger id="department-filter">
                <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="Filter by Department" />
              </SelectTrigger>
              <SelectContent>
                {uniqueDepartments.map(dept => (
                  <SelectItem key={dept} value={dept}>{dept === 'all' ? 'All Departments' : dept}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="export-format">Export Format</Label>
            <Select value={exportFormat} onValueChange={setExportFormat}>
              <SelectTrigger id="export-format">
                <SelectValue placeholder="Select export format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                <SelectItem value="csv">CSV (.csv)</SelectItem>
                <SelectItem value="pdf">PDF (.pdf)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
          <Button onClick={handleGenerateReport} disabled={isGenerating} className="w-full sm:w-auto">
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating Report...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" /> Generate & Download Report
              </>
            )}
          </Button>
          {generationStatus === 'success' && (
            <Alert variant="default" className="w-full sm:w-auto bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-700">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertTitle className="text-green-700 dark:text-green-300">Report Ready!</AlertTitle>
              <AlertDescription className="text-green-600 dark:text-green-400">
                Your report has been generated. Click <Button variant="link" className="p-0 h-auto text-green-600 dark:text-green-400 underline">here</Button> to download.
              </AlertDescription>
            </Alert>
          )}
          {generationStatus === 'error' && (
             <Alert variant="destructive" className="w-full sm:w-auto">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Generation Failed</AlertTitle>
              <AlertDescription>
                Could not generate the report. Please try again.
              </AlertDescription>
            </Alert>
          )}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>Previously Generated Reports</CardTitle>
            <CardDescription>Access reports generated in the past.</CardDescription>
        </CardHeader>
        <CardContent>
            <p className="text-muted-foreground">No previously generated reports found. Generated reports will appear here with options to download.</p>
            {/* Placeholder for report history table */}
        </CardContent>
      </Card>
    </div>
  );
}
