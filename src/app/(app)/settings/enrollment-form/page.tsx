"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authorizedFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { Loader2, Save, ArrowUp, ArrowDown, Eye, EyeOff } from "lucide-react";
import type { EnrollmentFormConfig, EnrollmentFormFieldConfig } from "@/types/region";

export default function EnrollmentFormSettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { userRole } = useAppAuth();
  const [config, setConfig] = useState<EnrollmentFormConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (userRole === null) return;
    if (userRole !== "admin" && userRole !== "superAdmin") {
      router.replace("/dashboard");
      return;
    }
    loadConfig();
  }, [userRole, router]);

  const loadConfig = async () => {
    try {
      const res = await authorizedFetch("/api/wizard/enrollment-config");
      const data = await res.json();
      setConfig(data.config);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: "Could not load enrollment config." });
    } finally {
      setLoading(false);
    }
  };

  const updateField = (sectionKey: string, fieldIndex: number, patch: Partial<EnrollmentFormFieldConfig>) => {
    if (!config) return;
    const newConfig = { ...config };
    const fields = [...newConfig.sections[sectionKey].fields];
    fields[fieldIndex] = { ...fields[fieldIndex], ...patch };
    newConfig.sections = { ...newConfig.sections, [sectionKey]: { ...newConfig.sections[sectionKey], fields } };
    setConfig(newConfig);
  };

  const moveField = (sectionKey: string, fieldIndex: number, direction: "up" | "down") => {
    if (!config) return;
    const targetIndex = direction === "up" ? fieldIndex - 1 : fieldIndex + 1;
    if (targetIndex < 0 || targetIndex >= config.sections[sectionKey].fields.length) return;
    const newConfig = { ...config };
    const fields = [...newConfig.sections[sectionKey].fields];
    [fields[fieldIndex], fields[targetIndex]] = [fields[targetIndex], fields[fieldIndex]];
    fields.forEach((f, i) => { f.order = i + 1; });
    newConfig.sections = { ...newConfig.sections, [sectionKey]: { ...newConfig.sections[sectionKey], fields } };
    setConfig(newConfig);
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await authorizedFetch("/api/wizard/enrollment-config", {
        method: "PUT",
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast({ title: "Saved", description: "Enrollment form configuration updated." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not save configuration." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Enrollment Form" backHref="/settings" />
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No enrollment configuration found. Complete the regional setup wizard first.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Enrollment Form"
        description="Customize which fields appear on the guard enrollment form. Changes apply immediately."
        actions={
          <Button onClick={saveConfig} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        }
      />

      {Object.entries(config.sections).map(([sectionKey, section]) => (
        <Card key={sectionKey}>
          <CardHeader>
            <CardTitle className="text-base">{section.label}</CardTitle>
            <CardDescription>
              {section.fields.filter((f) => f.enabled).length} of {section.fields.length} fields visible
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {section.fields.map((field, fieldIndex) => (
              <div
                key={field.key}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  field.enabled ? "bg-card" : "bg-muted/30 opacity-60"
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveField(sectionKey, fieldIndex, "up")} disabled={fieldIndex === 0}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveField(sectionKey, fieldIndex, "down")} disabled={fieldIndex === section.fields.length - 1}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{field.label}</p>
                    <code className="text-[10px] text-muted-foreground bg-muted px-1 rounded">{field.key}</code>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={field.required}
                      onCheckedChange={(checked) => updateField(sectionKey, fieldIndex, { required: checked })}
                      disabled={!field.enabled}
                      id={`required-${field.key}`}
                    />
                    <Label htmlFor={`required-${field.key}`} className="text-xs text-muted-foreground">Req</Label>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => updateField(sectionKey, fieldIndex, { enabled: !field.enabled })}
                  >
                    {field.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
