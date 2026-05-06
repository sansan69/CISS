"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/page-header";
import { Send, Megaphone, Users, Shield, UserCheck, Loader2, CheckCircle } from "lucide-react";

export default function AdminNotificationsPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [role, setRole] = useState<string>("all");
  const [district, setDistrict] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Missing fields", description: "Title and message are required.", variant: "destructive" });
      return;
    }

    setSending(true);
    setSent(false);

    try {
      const res = await fetch("/api/admin/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          role: role || undefined,
          district: district.trim() || undefined,
          data: { screen: "notifications" },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to send");
      }

      setSent(true);
      toast({ title: "Broadcast sent", description: "Notification delivered to recipients." });
      setTitle("");
      setBody("");
      setDistrict("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-content max-w-2xl">
      <PageHeader
        title="Broadcast Notifications"
        description="Send push notifications to guards and field officers"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Compose Broadcast
          </CardTitle>
          <CardDescription>
            Message will be delivered as a push notification and saved to their inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Title */}
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Important Update"
              className="mt-1"
            />
          </div>

          {/* Message */}
          <div>
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your broadcast message..."
              className="mt-1"
              rows={4}
            />
          </div>

          {/* Audience */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Audience</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select audience" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" /> All Users
                    </span>
                  </SelectItem>
                  <SelectItem value="guard">
                    <span className="flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Guards Only
                    </span>
                  </SelectItem>
                  <SelectItem value="fieldOfficer">
                    <span className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4" /> Field Officers Only
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>District (optional)</Label>
              <Input
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="e.g. Ernakulam"
                className="mt-1"
              />
            </div>
          </div>

          {/* Preview */}
          {title && body && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Preview
              </p>
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-brand-blue/10 flex items-center justify-center shrink-0">
                  <Megaphone className="h-5 w-5 text-brand-blue" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-sm text-muted-foreground">{body}</p>
                  <div className="flex gap-2 mt-2">
                    <Badge variant="outline" className="text-[10px]">
                      {role === "guard" ? "Guards" : role === "fieldOfficer" ? "Field Officers" : "All Users"}
                    </Badge>
                    {district && (
                      <Badge variant="outline" className="text-[10px]">{district}</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={sending || !title.trim() || !body.trim()}
            className="w-full"
            size="lg"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...
              </>
            ) : sent ? (
              <>
                <CheckCircle className="h-4 w-4 mr-2" /> Sent Successfully
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" /> Send Broadcast
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
