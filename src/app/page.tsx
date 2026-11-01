import React from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Search,
  Sparkles,
  ArrowRight,
  Database,
  Cpu,
  Layers,
  FileCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 selection:bg-blue-600 selection:text-white pb-20">
      {/* Navigation Header */}
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur-xs sticky top-0 z-50 shadow-xs">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-lg text-white shadow-xs">
              E
            </div>
            <div>
              <span className="font-bold tracking-tight text-lg text-slate-900">Edgelink</span>
              <span className="ml-2.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                SEO Automation
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <Link href="/client">
              <Button variant="ghost" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium text-sm">
                Client Portal
              </Button>
            </Link>
            <Link href="/admin">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm shadow-xs transition">
                Admin Console
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 py-16 space-y-16">
        <div className="max-w-3xl space-y-6">
          <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50 font-semibold px-3 py-1 rounded-full text-xs shadow-2xs">
            Phase 1 Foundation Ready
          </Badge>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-tight">
            AI-Driven SEO Audits &amp; Automated Optimization Engine
          </h1>
          <p className="text-lg md:text-xl text-slate-600 leading-relaxed font-normal">
            Enterprise-grade full-stack architecture running Next.js 14 App Router, Cheerio crawler, Claude AI analysis, BullMQ job queue, and Prisma PostgreSQL.
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <Link href="/client">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white gap-2 text-base font-semibold shadow-xs transition">
                Explore Client Dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/admin">
              <Button size="lg" variant="outline" className="border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 gap-2 text-base font-medium shadow-xs transition">
                Admin System Metrics
              </Button>
            </Link>
          </div>
        </div>

        {/* Foundation Architecture Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-white border-slate-200 shadow-xs hover:border-slate-300 hover:shadow-sm transition rounded-xl">
            <CardHeader className="space-y-1">
              <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center mb-3 shadow-2xs">
                <Search className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg font-bold text-slate-900">Crawler Engine</CardTitle>
              <CardDescription className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Cheerio &amp; native Fetch parser inspecting metadata, headings, images, and content.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-medium text-xs">
                Standalone / Testable
              </Badge>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-xs hover:border-slate-300 hover:shadow-sm transition rounded-xl">
            <CardHeader className="space-y-1">
              <div className="h-10 w-10 rounded-xl bg-purple-50 border border-purple-100 text-purple-600 flex items-center justify-center mb-3 shadow-2xs">
                <Sparkles className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg font-bold text-slate-900">Claude Intelligence</CardTitle>
              <CardDescription className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Anthropic Claude API (model claude-sonnet-4-6) generating prioritized recommendations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge className="bg-purple-50 text-purple-700 border-purple-200 font-medium text-xs">
                Mock &amp; Live Modes
              </Badge>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-xs hover:border-slate-300 hover:shadow-sm transition rounded-xl">
            <CardHeader className="space-y-1">
              <div className="h-10 w-10 rounded-xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center mb-3 shadow-2xs">
                <Layers className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg font-bold text-slate-900">BullMQ &amp; Redis</CardTitle>
              <CardDescription className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Decoupled asynchronous worker queue designed for reliable Upstash Redis execution.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-medium text-xs">
                Queue Configured
              </Badge>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-xs hover:border-slate-300 hover:shadow-sm transition rounded-xl">
            <CardHeader className="space-y-1">
              <div className="h-10 w-10 rounded-xl bg-sky-50 border border-sky-100 text-sky-600 flex items-center justify-center mb-3 shadow-2xs">
                <Database className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg font-bold text-slate-900">PostgreSQL &amp; Prisma</CardTitle>
              <CardDescription className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Type-safe Prisma client schema prepared for Supabase or Neon cloud databases.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge className="bg-sky-50 text-sky-700 border-sky-200 font-medium text-xs">
                Schema Defined
              </Badge>
            </CardContent>
          </Card>
        </div>

        {/* Phase 1 Verification Status Banner */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5">
              <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
              <span className="font-bold text-slate-900 text-base">Project Foundation Complete</span>
            </div>
            <p className="text-sm text-slate-600">
              Folder architecture, mock datasets, type definitions, environment validation, and UI components verified.
            </p>
          </div>
          <div className="flex items-center space-x-4 text-xs text-slate-500 font-medium">
            <span className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
              <Cpu className="h-4 w-4 text-slate-400" /> Node.js 24
            </span>
            <span className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
              <FileCheck2 className="h-4 w-4 text-slate-400" /> Next.js 14
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}

