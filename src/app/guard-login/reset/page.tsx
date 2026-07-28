"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Key as KeyRound, ShieldCheck } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function GuardResetPinPage() {
  return (
    <main className="min-h-[100dvh] bg-brand-blue-darker px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-6 text-center">
          <Image
            src="/ciss-logo.png"
            alt="CISS"
            width={72}
            height={72}
            className="mx-auto mb-4"
          />
          <p className="text-xs uppercase tracking-[0.28em] text-sky-200/80">Guard Portal</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Forgot PIN</h1>
        </header>

        <Card className="border-white/10 bg-white/95 text-slate-950 shadow-2xl">
          <CardHeader>
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-sky-700">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <CardTitle>Ask an administrator to reset your PIN</CardTitle>
            <CardDescription>
              For your security, guard PINs cannot be reset using personal details on this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              Contact your CISS administrator and provide your employee ID. The administrator
              will verify your identity, reset the PIN, and the action will be recorded.
            </div>
            <Button asChild className="h-12 w-full">
              <Link href="/guard-login">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Return to guard login
              </Link>
            </Button>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <KeyRound className="h-3.5 w-3.5" />
              First-time PIN setup remains available for guards without a PIN.
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
