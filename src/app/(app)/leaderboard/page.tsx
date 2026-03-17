"use client";

import React, { useState, useEffect, useCallback } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trophy, Medal, Star, Award, TrendingUp, TrendingDown, Minus, ShieldCheck, GraduationCap } from "lucide-react";
import { format } from "date-fns";
import { resolveAppUser } from "@/lib/auth/roles";
import type { GuardScore, Award as AwardType } from "@/types/evaluation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const CURRENT_PERIOD = format(new Date(), "yyyy-MM");

const BADGE_LABELS: Record<string, string> = {
  best_guard_monthly: "🏆 Best Guard",
  best_guard_quarterly: "🥇 Quarterly Champion",
  training_star: "⭐ Training Star",
  attendance_champion: "✅ Attendance Champion",
};

export default function LeaderboardPage() {
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [scores, setScores] = useState<GuardScore[]>([]);
  const [recentAwards, setRecentAwards] = useState<AwardType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [districtFilter, setDistrictFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [awardDialogOpen, setAwardDialogOpen] = useState(false);
  const [awardTarget, setAwardTarget] = useState<GuardScore | null>(null);
  const [awardNotes, setAwardNotes] = useState("");
  const [awarding, setAwarding] = useState(false);

  const keralaDistricts = ["Thiruvananthapuram","Kollam","Pathanamthitta","Alappuzha","Kottayam","Idukki","Ernakulam","Thrissur","Palakkad","Malappuram","Kozhikode","Wayanad","Kannur","Kasaragod"];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setToken(await user.getIdToken());
        try {
          const appUser = await resolveAppUser(user);
          setIsAdmin(appUser.role === "admin");
        } catch {}
        // Load clients
        try {
          const snap = await getDocs(collection(db, "clients"));
          setClients(snap.docs.map((d) => ({ id: d.id, name: d.data().name })));
        } catch {}
      }
    });
    return () => unsub();
  }, []);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (districtFilter !== "all") params.set("district", districtFilter);
      if (clientFilter !== "all") params.set("clientId", clientFilter);

      const [scoresRes, awardsRes] = await Promise.all([
        fetch(`/api/admin/leaderboard?${params}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/admin/awards", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const scoresData = await scoresRes.json();
      const awardsData = await awardsRes.json();
      setScores(scoresData.scores ?? []);
      setRecentAwards(awardsData.awards ?? []);
    } catch {
      toast({ title: "Failed to load leaderboard", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [token, districtFilter, clientFilter, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAwardDialog = (guard: GuardScore) => {
    setAwardTarget(guard);
    setAwardNotes("");
    setAwardDialogOpen(true);
  };

  const handleAward = async () => {
    if (!awardTarget || !token) return;
    setAwarding(true);
    try {
      const res = await fetch("/api/admin/awards", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: awardTarget.employeeId,
          employeeName: awardTarget.employeeName,
          employeeCode: awardTarget.employeeCode,
          district: awardTarget.district,
          clientId: awardTarget.clientId,
          clientName: awardTarget.clientName,
          profilePicUrl: awardTarget.profilePicUrl,
          type: "best_guard_monthly",
          period: CURRENT_PERIOD,
          score: awardTarget.currentMonthScore,
          notes: awardNotes,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: `🏆 ${awardTarget.employeeName} awarded Best Guard for ${format(new Date(CURRENT_PERIOD + "-01"), "MMMM yyyy")}!` });
      setAwardDialogOpen(false);
      fetchData();
    } catch {
      toast({ title: "Failed to award", variant: "destructive" });
    } finally {
      setAwarding(false);
    }
  };

  const topThree = scores.slice(0, 3);
  const rest = scores.slice(3);

  return (
    <div>
      <PageHeader
        title="Guard Leaderboard"
        description="Monthly performance rankings based on evaluations, attendance, and uniform compliance"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leaderboard" }]}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select value={districtFilter} onValueChange={setDistrictFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Districts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Districts</SelectItem>
            {keralaDistricts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-brand-blue" />
        </div>
      ) : scores.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <Trophy className="h-12 w-12 text-muted-foreground" />
            <div>
              <p className="font-semibold text-lg">No scores yet</p>
              <p className="text-sm text-muted-foreground mt-1">Complete guard evaluations to populate the leaderboard.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Podium — Top 3 */}
          {topThree.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Top Performers — {format(new Date(CURRENT_PERIOD + "-01"), "MMMM yyyy")}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {topThree.map((guard, i) => (
                  <PodiumCard
                    key={guard.id}
                    guard={guard}
                    rank={i + 1}
                    isAdmin={isAdmin}
                    onAward={openAwardDialog}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Full Rankings */}
          {rest.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Full Rankings
              </h2>
              <div className="space-y-2">
                {scores.map((guard, i) => (
                  <RankingRow
                    key={guard.id}
                    guard={guard}
                    rank={i + 1}
                    isAdmin={isAdmin}
                    onAward={openAwardDialog}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recent Awards */}
          {recentAwards.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Recent Awards
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recentAwards.slice(0, 6).map((award) => (
                  <Card key={award.id} className="bg-amber-50 border-amber-200">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="text-2xl">🏆</div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{award.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{BADGE_LABELS[award.type] ?? award.type}</p>
                        <p className="text-xs text-amber-700">{format(new Date(award.period + "-01"), "MMM yyyy")} · Score: {award.score}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Award Dialog */}
      <Dialog open={awardDialogOpen} onOpenChange={setAwardDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Award Best Guard</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {awardTarget && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-3xl">🏆</div>
                <div>
                  <p className="font-bold">{awardTarget.employeeName}</p>
                  <p className="text-sm text-muted-foreground">{awardTarget.clientName} · Score: {awardTarget.currentMonthScore}/100</p>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea value={awardNotes} onChange={(e) => setAwardNotes(e.target.value)} placeholder="Why this guard deserves the award..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAwardDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAward} disabled={awarding} className="bg-brand-gold hover:bg-brand-gold-light text-white">
              {awarding && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              🏆 Award
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PodiumCard({ guard, rank, isAdmin, onAward }: { guard: GuardScore; rank: number; isAdmin: boolean; onAward: (g: GuardScore) => void }) {
  const rankConfig = [
    { bg: "bg-amber-50 border-amber-300", icon: "🥇", label: "1st Place", textColor: "text-amber-700" },
    { bg: "bg-gray-50 border-gray-300", icon: "🥈", label: "2nd Place", textColor: "text-gray-600" },
    { bg: "bg-orange-50 border-orange-300", icon: "🥉", label: "3rd Place", textColor: "text-orange-700" },
  ][rank - 1] ?? { bg: "", icon: `#${rank}`, label: `${rank}th`, textColor: "text-foreground" };

  const trend = guard.currentMonthScore - (guard.previousMonthScore ?? guard.currentMonthScore);

  return (
    <Card className={`border-2 ${rankConfig.bg}`}>
      <CardContent className="flex flex-col items-center p-5 gap-3 text-center">
        <span className="text-4xl">{rankConfig.icon}</span>
        <Avatar className="h-14 w-14 ring-2 ring-brand-gold ring-offset-2">
          <AvatarImage src={guard.profilePicUrl} />
          <AvatarFallback className="bg-brand-blue text-white text-lg">
            {guard.employeeName?.[0]?.toUpperCase() ?? "G"}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-bold text-base">{guard.employeeName}</p>
          <p className="text-xs text-muted-foreground">{guard.clientName}</p>
          <p className="text-xs text-muted-foreground">{guard.district}</p>
        </div>
        <div className={`text-3xl font-black ${rankConfig.textColor}`}>
          {guard.currentMonthScore}
          <span className="text-sm font-normal text-muted-foreground">/100</span>
        </div>
        {/* Trend */}
        <div className={`flex items-center gap-1 text-xs font-medium ${trend > 0 ? "text-green-600" : trend < 0 ? "text-red-500" : "text-muted-foreground"}`}>
          {trend > 0 ? <TrendingUp className="h-3 w-3" /> : trend < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          {trend !== 0 ? `${trend > 0 ? "+" : ""}${trend} from last month` : "Same as last month"}
        </div>
        {/* Mini stats */}
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />{Math.round(guard.uniformComplianceRate * 100)}%</span>
          <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" />{guard.totalTrainingsCompleted}</span>
        </div>
        {/* Badges */}
        {guard.badges?.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1">
            {guard.badges.slice(0, 2).map((b) => (
              <Badge key={b} className="text-[10px] bg-brand-gold/20 text-amber-800 border-amber-300">
                {b.includes("best_guard") ? "🏆" : b.includes("training") ? "⭐" : "✅"}
              </Badge>
            ))}
          </div>
        )}
        {isAdmin && rank === 1 && (
          <Button
            size="sm"
            className="w-full bg-brand-gold hover:bg-brand-gold-light text-white text-xs"
            onClick={() => onAward(guard)}
          >
            🏆 Award Best Guard
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function RankingRow({ guard, rank, isAdmin, onAward }: { guard: GuardScore; rank: number; isAdmin: boolean; onAward: (g: GuardScore) => void }) {
  const rankIcon = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  const scoreColor = guard.currentMonthScore >= 80 ? "text-green-600" : guard.currentMonthScore >= 60 ? "text-amber-600" : "text-red-500";

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-muted-foreground w-8 text-center shrink-0">
            {rankIcon ?? `#${rank}`}
          </span>
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={guard.profilePicUrl} />
            <AvatarFallback className="bg-brand-blue text-white text-sm">
              {guard.employeeName?.[0]?.toUpperCase() ?? "G"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{guard.employeeName}</p>
            <p className="text-xs text-muted-foreground truncate">{guard.clientName} · {guard.district}</p>
          </div>
          {/* Score bar */}
          <div className="hidden sm:flex flex-col items-end gap-1 w-28 shrink-0">
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-brand-blue rounded-full transition-all" style={{ width: `${guard.currentMonthScore}%` }} />
            </div>
            <span className={`text-xs font-bold ${scoreColor}`}>{guard.currentMonthScore}/100</span>
          </div>
          <span className={`sm:hidden text-sm font-bold ${scoreColor} shrink-0`}>{guard.currentMonthScore}</span>
          {isAdmin && (
            <Button size="sm" variant="ghost" className="shrink-0 h-8 px-2 text-xs" onClick={() => onAward(guard)}>
              <Trophy className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
