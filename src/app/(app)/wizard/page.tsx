"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, ArrowRight, Building2, MapPin, Users, FileEdit, ShieldCheck, Sparkles } from "lucide-react";
import { authorizedFetch } from "@/lib/api-client";

const WIZARD_STEPS = [
  { key: "profile", label: "State Profile", icon: Building2 },
  { key: "districts", label: "Districts", icon: MapPin },
  { key: "enrollmentConfig", label: "Enrollment Form", icon: FileEdit },
  { key: "clients", label: "Clients & Sites", icon: Building2 },
  { key: "fieldOfficers", label: "Field Officers", icon: Users },
  { key: "verify", label: "Verification", icon: ShieldCheck },
];

export default function WizardPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [setupData, setSetupData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (userRole === undefined || userRole === null) return;
    if (userRole !== "admin") {
      router.replace("/dashboard");
      return;
    }
    fetchWizardStatus();
  }, [userRole, router]);

  const fetchWizardStatus = async () => {
    try {
      const res = await authorizedFetch("/api/wizard/profile");
      const data = await res.json();
      if (data.setupComplete) {
        router.replace("/dashboard");
        return;
      }
      setSetupData(data);
      setCurrentStep(data.setupProgress?.currentStep ?? 0);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  const saveStep = useCallback(async (stepKey: string, endpoint: string, body: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const res = await authorizedFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setCurrentStep((prev) => Math.min(prev + 1, WIZARD_STEPS.length - 1));
      toast({ title: "Saved", description: `Step "${stepKey}" completed.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setSubmitting(false);
    }
  }, [toast]);

  const completeWizard = async () => {
    setSubmitting(true);
    try {
      await authorizedFetch("/api/wizard/complete", { method: "POST" });
      toast({ title: "Setup Complete!", description: "Redirecting to dashboard..." });
      router.push("/dashboard");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const step = WIZARD_STEPS[currentStep];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">Welcome to Your State Dashboard</h1>
          <p className="mt-2 text-muted-foreground">
            Complete the setup steps below to configure your region.
          </p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {WIZARD_STEPS.map((s, i) => {
              const Icon = s.icon;
              const isDone = i < currentStep;
              const isCurrent = i === currentStep;
              return (
                <div key={s.key} className="flex flex-col items-center gap-1.5">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                      isDone
                        ? "bg-primary text-primary-foreground"
                        : isCurrent
                          ? "ring-2 ring-primary ring-offset-2 bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <span className={`text-[10px] font-medium ${isCurrent ? "text-foreground" : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <Card>
          <CardHeader>
            <CardTitle>{step.label}</CardTitle>
            <CardDescription>
              {currentStep === 0 && "Confirm your state profile and timezone settings."}
              {currentStep === 1 && "Add the districts where guards will be deployed."}
              {currentStep === 2 && "Choose which fields appear on the guard enrollment form."}
              {currentStep === 3 && "Create your first client and optionally add sites."}
              {currentStep === 4 && "Create field officers and assign their districts."}
              {currentStep === 5 && "Verify that everything is set up correctly."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {currentStep === 0 && <StepProfile setupData={setupData} onSave={(d: Record<string, unknown>) => saveStep("profile", "/api/wizard/profile", d)} submitting={submitting} />}
            {currentStep === 1 && <StepDistricts onSave={(d: Record<string, unknown>) => saveStep("districts", "/api/wizard/districts", d)} submitting={submitting} />}
            {currentStep === 2 && <StepEnrollmentConfig onSave={(d: Record<string, unknown>) => saveStep("enrollment-config", "/api/wizard/enrollment-config", d)} submitting={submitting} />}
            {currentStep === 3 && <StepClients onSave={(d: Record<string, unknown>) => saveStep("clients", "/api/wizard/clients", d)} submitting={submitting} />}
            {currentStep === 4 && <StepFieldOfficers onSave={(d: Record<string, unknown>) => saveStep("field-officers", "/api/wizard/field-officers", d)} submitting={submitting} />}
            {currentStep === 5 && <StepVerify onComplete={completeWizard} submitting={submitting} />}
          </CardContent>
        </Card>

        {/* Progress summary */}
        <div className="mt-4 text-center text-xs text-muted-foreground">
          Step {currentStep + 1} of {WIZARD_STEPS.length}
        </div>
      </div>
    </div>
  );
}

function StepProfile({ setupData, onSave, submitting }: any) {
  const [name, setName] = useState(setupData.regionName || "");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  return (
    <div className="space-y-4">
      <div>
        <Label>State Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tamil Nadu" />
      </div>
      <div>
        <Label>Timezone</Label>
        <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </div>
      <Button onClick={() => onSave({ regionName: name, timezone })} disabled={!name || submitting} className="w-full">
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
        Continue
      </Button>
    </div>
  );
}

function StepDistricts({ onSave, submitting }: any) {
  const [districts, setDistricts] = useState<string[]>([]);
  const [input, setInput] = useState("");

  const addDistrict = () => {
    if (input.trim() && !districts.includes(input.trim())) {
      setDistricts([...districts, input.trim()]);
      setInput("");
    }
  };

  const removeDistrict = (d: string) => setDistricts(districts.filter((x) => x !== d));
  const toggleDistrict = (d: string) => setDistricts((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type district name and press Add" onKeyDown={(e) => e.key === "Enter" && addDistrict()} />
        <Button variant="outline" onClick={addDistrict} disabled={!input.trim()}>Add</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {districts.map((d) => (
          <Badge key={d} variant="secondary" className="cursor-pointer gap-1" onClick={() => removeDistrict(d)}>
            {d} &times;
          </Badge>
        ))}
      </div>
      {districts.length < 1 && <p className="text-xs text-muted-foreground">Add at least one district to continue.</p>}
      <Button onClick={() => onSave({ districts: districts.map((name) => ({ name, active: true })) })} disabled={districts.length < 1 || submitting} className="w-full">
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
        Save Districts &amp; Continue
      </Button>
    </div>
  );
}

function StepEnrollmentConfig({ onSave, submitting }: any) {
  const config = {
    sections: {
      personal: { label: "Personal Info", fields: ["firstName", "lastName", "fatherName", "motherName", "dateOfBirth", "gender", "maritalStatus", "educationalQualification", "resourceIdNumber"] },
      documents: { label: "Documents", fields: ["identityProofType", "identityProofNumber", "addressProofType", "addressProofNumber", "signatureUrl"] },
      bank: { label: "Bank Details", fields: ["bankAccountNumber", "ifscCode", "bankName"] },
      details: { label: "Other Details", fields: ["district", "fullAddress", "emailAddress", "clientName", "joiningDate"] },
    },
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">All fields are enabled by default. You can customize these later in Settings.</p>
      {Object.entries(config.sections).map(([key, section]) => (
        <div key={key}>
          <p className="text-sm font-semibold mb-2">{section.label}</p>
          <div className="flex flex-wrap gap-2">
            {section.fields.map((f: string) => (
              <Badge key={f} variant="outline" className="bg-green-50 text-green-700 border-green-200">{f}</Badge>
            ))}
          </div>
        </div>
      ))}
      <Button onClick={() => onSave({ config })} disabled={submitting} className="w-full">
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
        Accept Defaults &amp; Continue
      </Button>
    </div>
  );
}

function StepClients({ onSave, submitting }: any) {
  const [clientName, setClientName] = useState("");
  return (
    <div className="space-y-4">
      <div>
        <Label>Client Name</Label>
        <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. TCS" />
      </div>
      <Button onClick={() => onSave({ clientName })} disabled={!clientName || submitting} className="w-full">
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
        Save Client &amp; Continue
      </Button>
    </div>
  );
}

function StepFieldOfficers({ onSave, submitting }: any) {
  const [officers, setOfficers] = useState<Array<{ name: string; email: string; districts: string[] }>>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const addOfficer = () => {
    if (name.trim() && email.trim()) {
      setOfficers([...officers, { name: name.trim(), email: email.trim(), districts: [] }]);
      setName("");
      setEmail("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Officer name" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
        <Button variant="outline" onClick={addOfficer} disabled={!name || !email}>Add</Button>
      </div>
      {officers.map((o, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
          <span className="font-medium">{o.name}</span>
          <span className="text-muted-foreground">{o.email}</span>
          <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => setOfficers(officers.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <Button onClick={() => onSave({ officers })} disabled={officers.length < 1 || submitting} className="w-full">
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
        Save Officers &amp; Continue
      </Button>
    </div>
  );
}

function StepVerify({ onComplete, submitting }: any) {
  const [checks, setChecks] = useState<Record<string, boolean> | null>(null);
  const [running, setRunning] = useState(false);

  const runCheck = async () => {
    setRunning(true);
    try {
      const res = await authorizedFetch("/api/wizard/verify", { method: "POST" });
      const data = await res.json();
      setChecks(data.checks);
    } catch {
      setChecks({ error: false });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {!checks && (
        <Button onClick={runCheck} disabled={running} className="w-full">
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Run Verification
        </Button>
      )}
      {checks && (
        <>
          <div className="space-y-2">
            {Object.entries(checks).map(([key, passed]) => (
              <div key={key} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                {passed ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <span className="h-5 w-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">!</span>}
                <span className={passed ? "text-green-700" : "text-red-700"}>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                {passed ? <span className="ml-auto text-green-600 text-xs">Passed</span> : <span className="ml-auto text-red-600 text-xs">Missing</span>}
              </div>
            ))}
          </div>
          <Button onClick={onComplete} disabled={submitting || Object.values(checks).some((v) => !v)} className="w-full">
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Complete Setup
          </Button>
        </>
      )}
    </div>
  );
}
