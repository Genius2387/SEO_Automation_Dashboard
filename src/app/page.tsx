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
    <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-blue-600 selection:text-white">
      {/* Navigation Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-lg shadow-lg shadow-blue-500/20">
              E
            </div>
            <div>
              <span className="font-bold tracking-tight text-lg">Edgelink</span>
              <span className="ml-2 text-xs font-medium text-blue-400 bg-blue-950/70 border border-blue-800 px-2 py-0.5 rounded-full">
                SEO Automation
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <Link href="/client">
              <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-slate-800">
                Client Portal
              </Button>
            </Link>
            <Link href="/admin">
              <Button className="bg-blue-600 hover:bg-blue-500 text-white">
                Admin Console
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 py-20 space-y-16">
        <div className="max-w-3xl space-y-6">
          <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-950/40">
            Phase 1 Foundation Ready
          </Badge>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white leading-tight">
            AI-Driven SEO Audits &amp; Automated Optimization Engine
          </h1>
          <p className="text-lg md:text-xl text-slate-400 leading-relaxed">
            Enterprise-grade full-stack architecture running Next.js 14 App Router, Cheerio crawler, Claude AI analysis, BullMQ job queue, and Prisma PostgreSQL.
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <Link href="/client">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-500 text-white gap-2 text-base">
                Explore Client Dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/admin">
              <Button size="lg" variant="outline" className="border-slate-800 text-slate-300 hover:text-white hover:bg-slate-900 gap-2 text-base">
                Admin System Metrics
              </Button>
            </Link>
          </div>
        </div>

        {/* Foundation Architecture Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-slate-900/60 border-slate-800 backdrop-blur text-slate-100">
            <CardHeader className="space-y-1">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-2">
                <Search className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg text-white">Crawler Engine</CardTitle>
              <CardDescription className="text-slate-400">
                Cheerio &amp; native Fetch parser inspecting metadata, headings, images, and content.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                Standalone / Testable
              </Badge>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/60 border-slate-800 backdrop-blur text-slate-100">
            <CardHeader className="space-y-1">
              <div className="h-10 w-10 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-2">
                <Sparkles className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg text-white">Claude Intelligence</CardTitle>
              <CardDescription className="text-slate-400">
                Anthropic Claude API (model claude-sonnet-4-6) generating prioritized recommendations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="border-indigo-500/30 text-indigo-400">
                Mock &amp; Live Modes
              </Badge>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/60 border-slate-800 backdrop-blur text-slate-100">
            <CardHeader className="space-y-1">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center mb-2">
                <Layers className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg text-white">BullMQ &amp; Redis</CardTitle>
              <CardDescription className="text-slate-400">
                Decoupled asynchronous worker queue designed for reliable Upstash Redis execution.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="border-amber-500/30 text-amber-400">
                Queue Configured
              </Badge>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/60 border-slate-800 backdrop-blur text-slate-100">
            <CardHeader className="space-y-1">
              <div className="h-10 w-10 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-2">
                <Database className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg text-white">PostgreSQL &amp; Prisma</CardTitle>
              <CardDescription className="text-slate-400">
                Type-safe Prisma client schema prepared for Supabase or Neon cloud databases.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="border-cyan-500/30 text-cyan-400">
                Schema Defined
              </Badge>
            </CardContent>
          </Card>
        </div>

        {/* Phase 1 Verification Status Banner */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <span className="font-semibold text-white">Project Foundation Complete</span>
            </div>
            <p className="text-sm text-slate-400">
              Folder architecture, mock datasets, type definitions, environment validation, and UI components verified.
            </p>
          </div>
          <div className="flex items-center space-x-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Cpu className="h-4 w-4 text-slate-500" /> Node.js 24
            </span>
            <span className="flex items-center gap-1">
              <FileCheck2 className="h-4 w-4 text-slate-500" /> Next.js 14
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
