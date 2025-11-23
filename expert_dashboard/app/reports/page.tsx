"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, TrendingUp, Camera, CheckCircle2, Calendar, TrendingDown, AlertTriangle, BarChart3, Activity, Leaf, Apple, Download } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Label,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import ChartCard from "@/components/charts/ChartCard";
import { useData } from "@/components/DataContext";
import { supabase } from "@/components/supabase";
import toast from "react-hot-toast";
import dayjs from "dayjs";

import type { Scan, ValidationHistory } from "@/types";
import { getAiPrediction, isLeafDiseaseScan, isFruitRipenessScan } from "@/types";

// Recharts Tooltip payload entry type
type TooltipPayloadEntry = {
  name: string;
  value: number;
  payload?: AppPerformanceDatum | MonthlyMostScannedDatum;
  color?: string;
  dataKey?: string;
};

// Recharts Tooltip formatter props type
type TooltipFormatterProps = {
  value: number;
  name: string;
  payload?: AppPerformanceDatum | MonthlyMostScannedDatum;
};

// Recharts Bar label props type
type BarLabelProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload?: MonthlyMostScannedDatum;
};

type Range = "today" | "this_week" | "this_month" | "custom";

type TrendDatum = {
  period: string;
  scans: number;
};

type DistributionDatum = {
  name: string;
  value: number;
};


// Disease color mapping - Unique colors per disease
const DISEASE_COLORS: Record<string, string> = {
  "Cercospora": "#F97316", // Orange
  "Yellow Mosaic Virus": "#EAB308", // Yellow
  "Healthy": "#22C55E", // Green
  "Fusarium Wilt": "#EF4444", // Red
  "Downy Mildew": "#3B82F6", // Blue
};

// Ripeness color mapping - Unique colors per ripeness stage
const RIPENESS_COLORS: Record<string, string> = {
  "Immature": "#EAB308", // Yellow
  "Mature": "#22C55E", // Green
  "Overmature": "#F97316", // Orange
  "Overripe": "#EF4444", // Red
};

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "custom", label: "Custom" },
];
const RANGE_LABELS: Record<Range, string> = {
  today: "Today",
  this_week: "This Week",
  this_month: "This Month",
  custom: "Custom Range",
};

const ONE_DAY = 24 * 60 * 60 * 1000;
// Date formatters without timezone conversion
const HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", { 
  hour: "numeric"
});
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { 
  month: "short", 
  day: "numeric"
});
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", { 
  weekday: "short"
});

function getRangeStart(range: Range, customStart?: Date) {
  if (range === "custom" && customStart) {
    const start = new Date(customStart);
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  if (range === "today") {
    return now;
  }
  if (range === "this_week") {
    // Get Monday of current week in UTC
    const day = now.getUTCDay();
    const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
    monday.setUTCHours(0, 0, 0, 0);
    return monday;
  }
  // this_month: start of current month in UTC
  if (range === "this_month") {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    monthStart.setUTCHours(0, 0, 0, 0);
    return monthStart;
  }
  return now;
}

function getRangeEnd(range: Range, customEnd?: Date) {
  if (range === "custom" && customEnd) {
    // For custom range, set to end of day in UTC
    const end = new Date(customEnd);
    end.setUTCHours(23, 59, 59, 999);
    return end;
  }
  const now = new Date();
  if (range === "today") {
    // For today range, set to end of today (23:59:59.999) in UTC
    const todayEnd = new Date(now);
    todayEnd.setUTCHours(23, 59, 59, 999);
    return todayEnd;
  }
  // For this_week and this_month, return current time (will be adjusted dynamically in filtering)
  return now;
}

function buildScansTrend(range: Range, scans: Scan[], rangeStart: Date, rangeEnd: Date): TrendDatum[] {
  if (!scans || scans.length === 0) {
    // Return empty state based on range
    if (range === "today") {
      // Return all 24 hours with 0 counts (12-hour format with AM/PM)
      return Array.from({ length: 24 }, (_, hour) => {
        // Convert hour (0-23) to 12-hour format with AM/PM
        let hours = hour;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours === 0 ? 12 : hours;
        const hourLabel = `${hours} ${ampm}`;
        return {
          period: hourLabel,
          scans: 0,
        };
      });
    }
    return [];
  }

  if (range === "today") {
    // For "today" range, bucket scans by hour using UTC time (as stored in Supabase)
    // Display shows UTC hours (07:00) instead of local time (15:00 PH)
    const counts = new Map<number, number>();

    scans.forEach((scan) => {
      try {
        if (!scan.created_at) return;
        
        // Parse UTC timestamp from Supabase (ensures UTC timezone)
        const scanDate = new Date(scan.created_at);
        if (isNaN(scanDate.getTime())) {
          return;
        }
        
        // Get hour in UTC time (as stored in Supabase, no timezone conversion)
        const utcHour = scanDate.getUTCHours();
        
        // Validate hour is in valid range
        if (utcHour < 0 || utcHour > 23) {
          return;
        }
        
        // Bucket the scan by UTC hour (displays 07:00 instead of 15:00)
        counts.set(utcHour, (counts.get(utcHour) ?? 0) + 1);
      } catch (error) {
        // Skip invalid dates
        return;
      }
    });

    // Generate data points for all 24 hours (12-hour format with AM/PM)
    // Always show all 24 hours to ensure complete chart display
    return Array.from({ length: 24 }, (_, hour) => {
      // Convert hour (0-23) to 12-hour format with AM/PM
      let hours = hour;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours === 0 ? 12 : hours;
      const hourLabel = `${hours} ${ampm}`;
      return {
        period: hourLabel,
        scans: counts.get(hour) ?? 0,
      };
    });
  }

  // For this_week, this_month, and custom ranges: bucket by day using LOCAL time
  const now = new Date();
  let startDate: Date;
  let endDate: Date;
  
  if (range === "this_week") {
    // Monday 00:00 local → today 23:59 local
    const dayOfWeek = now.getDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    startDate = new Date(now);
    startDate.setDate(now.getDate() - diffToMonday);
    startDate.setHours(0, 0, 0, 0);
    
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (range === "this_month") {
    // 1st day of month 00:00 local → today 23:59 local
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else {
    // Custom range: use provided dates
    startDate = new Date(rangeStart);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(rangeEnd);
    endDate.setHours(23, 59, 59, 999);
  }

  // Calculate total days in range (inclusive)
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / ONE_DAY) + 1);

  const bucketCounts = new Map<string, number>();
  
  scans.forEach((scan) => {
    if (!scan.created_at) return;
    try {
      // Convert Supabase UTC timestamp to local time
      const scanDate = new Date(scan.created_at);
      if (isNaN(scanDate.getTime())) {
        return;
      }
      
      // Get the date string in LOCAL time using toLocaleDateString('en-CA') which gives YYYY-MM-DD
      const scanDateStr = scanDate.toLocaleDateString('en-CA');
      
      // Check if scan is within range (inclusive boundaries)
      if (scanDate < startDate || scanDate > endDate) {
        return;
      }
      
      // Use date string as bucket key for grouping by local date
      bucketCounts.set(scanDateStr, (bucketCounts.get(scanDateStr) ?? 0) + 1);
    } catch (error) {
      // Skip invalid dates
      return;
    }
  });

  if (range === "this_week") {
    // Always show all 7 days of the week: Sunday → Monday → Tuesday → ... → Saturday
    // Pre-fill weekday array and map filtered scans to it
    const result: TrendDatum[] = [];
    const now = new Date();
    
    // Calculate Sunday of current week (start of week in local time)
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - dayOfWeek);
    sunday.setHours(0, 0, 0, 0);
    
    // Generate all 7 days (Sunday through Saturday) using LOCAL dates
    for (let idx = 0; idx < 7; idx++) {
      const dayDate = new Date(sunday);
      dayDate.setDate(sunday.getDate() + idx);
      const dayDateStr = dayDate.toLocaleDateString('en-CA');
      
      result.push({
        period: WEEKDAY_FORMATTER.format(dayDate),
        scans: bucketCounts.get(dayDateStr) ?? 0, // 0 if no scans for this day
      });
    }
    
    return result;
  }

  // this_month or Custom: Daily buckets using LOCAL dates
  return Array.from({ length: totalDays }, (_, idx) => {
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + idx);
    const dayDateStr = dayDate.toLocaleDateString('en-CA');
    return {
      period: DAY_FORMATTER.format(dayDate),
      scans: bucketCounts.get(dayDateStr) ?? 0,
    };
  });
}

// App Performance data type for 12 months
type AppPerformanceDatum = {
  month: string;
  successRate: number;
  totalScans: number;
  validatedScans: number;
  avgConfidence: number;
  aiAccuracyRate: number; // AI Accuracy Rate per month
};

// Build App Performance data - Always 12 months
function buildAppPerformance(scans: Scan[], validationHistory?: ValidationHistory[]): AppPerformanceDatum[] {
  const now = new Date();
  const months: AppPerformanceDatum[] = [];
  
  // Generate last 12 months with zero initialization
  for (let i = 11; i >= 0; i--) {
    // Calculate month in UTC
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    // Format as "Jan" (month only, no year) for cleaner display
    const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });
    
    // Calculate month boundaries in UTC (start of month to end of month)
    const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    
    // Filter scans for this month (optimized with early returns)
    // Also exclude Unknown scans from metrics
    const monthScans = scans.filter((scan) => {
      // Exclude scans with status = 'Unknown'
      if ((scan.status as string) === 'Unknown') return false;
      // Exclude scans with result = 'Unknown' (disease_detected or ripeness_stage)
      const result = getAiPrediction(scan);
      if (result === 'Unknown') return false;
      
      if (!scan?.created_at) return false;
      try {
        // Use UTC timestamp directly from Supabase
        const scanDate = new Date(scan.created_at);
        if (isNaN(scanDate.getTime())) return false;
        
        // Compare in UTC (using date string for date comparison)
        const scanDateStr = scanDate.toISOString().split("T")[0];
        const monthStartStr = monthStart.toISOString().split("T")[0];
        const monthEndStr = monthEnd.toISOString().split("T")[0];
        return scanDateStr >= monthStartStr && scanDateStr <= monthEndStr;
      } catch {
        return false;
      }
    });
    
    // Calculate metrics
    const totalScans = monthScans.length;
    const validatedScans = monthScans.filter((scan) => 
      scan.status && scan.status !== "Pending Validation"
    ).length;
    
    // Success rate = (Validated scans / Total scans) * 100
    const successRate = totalScans > 0 ? (validatedScans / totalScans) * 100 : 0;
    
    // AI Accuracy Rate = (Validated count) / (Validated + Corrected count) * 100
    // Note: Both "Confirm" and "Correct" actions set scan.status to "Validated"
    // The validation_history table tracks whether it was "Validated" or "Corrected" for AI accuracy
    let aiAccuracyRate = 0;
    if (validationHistory && validationHistory.length > 0) {
      // Filter validation history for this month, excluding Unknown scans
      const monthValidations = validationHistory.filter((vh) => {
        if (!vh?.validated_at) return false;
        
        // Exclude validations for Unknown scans
        if (vh.scan) {
          if ((vh.scan.status as string) === 'Unknown') return false;
          const result = getAiPrediction(vh.scan);
          if (result === 'Unknown') return false;
        }
        
        try {
          // Use UTC timestamp directly from Supabase
          const validationDate = new Date(vh.validated_at);
          if (isNaN(validationDate.getTime())) return false;
          
          // Compare in UTC (using date string for date comparison)
          const validationDateStr = validationDate.toISOString().split("T")[0];
          const monthStartStr = monthStart.toISOString().split("T")[0];
          const monthEndStr = monthEnd.toISOString().split("T")[0];
          return validationDateStr >= monthStartStr && validationDateStr <= monthEndStr;
        } catch {
          return false;
        }
      });
      
      // Count validated (AI was correct, expert confirmed) and corrected (AI was wrong, expert corrected)
      const validatedCount = monthValidations.filter((vh) => vh.status === "Validated").length;
      const correctedCount = monthValidations.filter((vh) => vh.status === "Corrected").length;
      const totalValidatedOrCorrected = validatedCount + correctedCount;
      
      aiAccuracyRate = totalValidatedOrCorrected > 0 
        ? (validatedCount / totalValidatedOrCorrected) * 100 
        : 0;
    }
    
    // Calculate average confidence (optimized)
    let totalConfidence = 0;
    let confidenceCount = 0;
    
    for (const scan of monthScans) {
      if (scan.confidence !== null && scan.confidence !== undefined) {
        const conf = typeof scan.confidence === 'string' ? parseFloat(scan.confidence) : scan.confidence;
        if (!isNaN(conf)) {
          totalConfidence += conf;
          confidenceCount++;
        }
      }
    }
    
    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;
    
    months.push({
      month: monthName,
      successRate: parseFloat(successRate.toFixed(1)),
      totalScans,
      validatedScans,
      avgConfidence: parseFloat(avgConfidence.toFixed(1)),
      aiAccuracyRate: parseFloat(aiAccuracyRate.toFixed(1)),
    });
  }
  
  return months;
}

// Monthly Most Scanned data type
type MonthlyMostScannedDatum = {
  month: string;
  leafDiseaseCount: number;
  fruitRipenessCount: number;
  mostScannedDisease: string;
  mostScannedRipeness: string;
  diseaseColor: string;
  ripenessColor: string;
  totalCount: number;
};

// Build Monthly Most Scanned data - Last 12 months
function buildMonthlyMostScanned(scans: Scan[]): MonthlyMostScannedDatum[] {
  const now = new Date();
  const months: MonthlyMostScannedDatum[] = [];
  
  // Generate last 12 months
  for (let i = 11; i >= 0; i--) {
    // Calculate month in UTC
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });
    
    // Calculate month boundaries in UTC
    const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    
    // Filter scans for this month (exclude Unknown scans)
    const monthScans = scans.filter((scan) => {
      // Exclude scans with status = 'Unknown'
      if ((scan.status as string) === 'Unknown') return false;
      // Exclude scans with result = 'Unknown' (disease_detected or ripeness_stage)
      const result = getAiPrediction(scan);
      if (result === 'Unknown') return false;
      
      if (!scan?.created_at) return false;
      try {
        // Use UTC timestamp directly from Supabase
        const scanDate = new Date(scan.created_at);
        if (isNaN(scanDate.getTime())) return false;
        
        // Compare in UTC (using date string for date comparison)
        const scanDateStr = scanDate.toISOString().split("T")[0];
        const monthStartStr = monthStart.toISOString().split("T")[0];
        const monthEndStr = monthEnd.toISOString().split("T")[0];
        return scanDateStr >= monthStartStr && scanDateStr <= monthEndStr;
      } catch {
        return false;
      }
    });
    
    // Count leaf disease scans and find most scanned
    const diseaseCounts = new Map<string, number>();
    const ripenessCounts = new Map<string, number>();
    
    monthScans.forEach((scan) => {
      const prediction = getAiPrediction(scan)?.trim() || '';
      // Skip empty predictions and Unknown results
      if (!prediction || prediction === 'Unknown') return;
      
      if (scan.scan_type === 'leaf_disease') {
        diseaseCounts.set(prediction, (diseaseCounts.get(prediction) || 0) + 1);
      } else if (scan.scan_type === 'fruit_maturity') {
        ripenessCounts.set(prediction, (ripenessCounts.get(prediction) || 0) + 1);
      }
    });
    
    // Find most scanned disease
    let mostScannedDisease = 'N/A';
    let maxDiseaseCount = 0;
    diseaseCounts.forEach((count, disease) => {
      if (count > maxDiseaseCount) {
        maxDiseaseCount = count;
        mostScannedDisease = disease;
      }
    });
    
    // Find most scanned ripeness
    let mostScannedRipeness = 'N/A';
    let maxRipenessCount = 0;
    ripenessCounts.forEach((count, ripeness) => {
      if (count > maxRipenessCount) {
        maxRipenessCount = count;
        mostScannedRipeness = ripeness;
      }
    });
    
    // Get colors
    const diseaseColor = DISEASE_COLORS[mostScannedDisease] || "#388E3C";
    const ripenessColor = RIPENESS_COLORS[mostScannedRipeness] || "#388E3C";
    
    // Determine which has more scans to decide bar color
    const leafDiseaseCount = Array.from(diseaseCounts.values()).reduce((sum, count) => sum + count, 0);
    const fruitRipenessCount = Array.from(ripenessCounts.values()).reduce((sum, count) => sum + count, 0);
    const totalCount = leafDiseaseCount + fruitRipenessCount;
    
    months.push({
      month: monthName,
      leafDiseaseCount,
      fruitRipenessCount,
      mostScannedDisease: mostScannedDisease !== 'N/A' ? mostScannedDisease : '',
      mostScannedRipeness: mostScannedRipeness !== 'N/A' ? mostScannedRipeness : '',
      diseaseColor,
      ripenessColor,
      totalCount,
    });
  }
  
  return months;
}

// Expert Validation Performance data type
type ExpertValidationDatum = {
  month: string;
  aiValidated: number; // AI predictions that were confirmed (status: 'Validated')
  aiCorrected: number; // AI predictions that were corrected (status: 'Corrected')
  mismatchRate: number; // Percentage of corrected predictions
  totalValidations: number;
};

// Build Expert Validation Performance data based on selected range
function buildExpertValidationPerformanceFiltered(
  range: Range,
  validationHistory: ValidationHistory[],
  rangeStart: Date,
  rangeEnd: Date
): ExpertValidationDatum[] {
  if (!validationHistory || validationHistory.length === 0) return [];
  
  // Filter validations within the selected range
  // Also exclude validations for scans with Unknown status or Unknown result
  // Use UTC timestamps directly from Supabase
  const filteredValidations = validationHistory.filter((vh) => {
    if (!vh?.validated_at) return false;
    
    // Exclude validations for Unknown scans
    if (vh.scan) {
      // Exclude scans with status = 'Unknown'
      if ((vh.scan.status as string) === 'Unknown') return false;
      // Exclude scans with result = 'Unknown' (disease_detected or ripeness_stage)
      const result = getAiPrediction(vh.scan);
      if (result === 'Unknown') return false;
    }
    
    try {
      // Use UTC timestamp directly from Supabase
      const validationDate = new Date(vh.validated_at);
      if (isNaN(validationDate.getTime())) return false;
      
      // Compare timestamps for accurate date range filtering
      const validationTime = validationDate.getTime();
      const rangeStartTime = rangeStart.getTime();
      const rangeEndTime = rangeEnd.getTime();
      
      return validationTime >= rangeStartTime && validationTime <= rangeEndTime;
    } catch {
      return false;
    }
  });

  if (filteredValidations.length === 0) return [];

  const data: ExpertValidationDatum[] = [];

  if (range === "today") {
    // Group by hour
    // For "today" range, always use today's date dynamically (not the memoized rangeEnd)
    // This ensures real-time updates work correctly - new validations added today are immediately included
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const base = new Date(rangeStart);
    base.setUTCHours(0, 0, 0, 0);
    const isToday = today.getTime() === base.getTime();
    const now = new Date();
    const currentHour = isToday ? Math.min(now.getUTCHours() + 1, 24) : 24;
    
    for (let hour = 0; hour < currentHour; hour++) {
      const hourStart = new Date(base);
      hourStart.setUTCHours(hour, 0, 0, 0);
      const hourEnd = new Date(base);
      hourEnd.setUTCHours(hour, 59, 59, 999);
      
      const hourValidations = filteredValidations.filter((vh) => {
        try {
          // Use UTC timestamp directly from Supabase
          const validationDate = new Date(vh.validated_at);
          if (isNaN(validationDate.getTime())) return false;
          const validationTime = validationDate.getTime();
          return validationTime >= hourStart.getTime() && validationTime <= hourEnd.getTime();
        } catch {
          return false;
        }
      });
      
      const aiValidated = hourValidations.filter((vh) => vh.status === "Validated").length;
      const aiCorrected = hourValidations.filter((vh) => vh.status === "Corrected").length;
      const totalValidations = hourValidations.length;
      const mismatchRate = totalValidations > 0 ? (aiCorrected / totalValidations) * 100 : 0;
      
      const stamp = new Date(base);
      stamp.setUTCHours(hour);
      const periodLabel = HOUR_FORMATTER.format(stamp);
      
      data.push({
        month: periodLabel,
        aiValidated,
        aiCorrected,
        mismatchRate: parseFloat(mismatchRate.toFixed(1)),
        totalValidations,
      });
    }
  } else if (range === "this_week") {
    // Group by day
    const startDay = new Date(rangeStart);
    startDay.setUTCHours(0, 0, 0, 0);
    const endDay = new Date(rangeEnd);
    endDay.setUTCHours(0, 0, 0, 0);
    const totalDays = Math.ceil((endDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const buckets = Math.min(7, totalDays);
    
    for (let idx = 0; idx < buckets; idx++) {
      const stamp = new Date(startDay);
      stamp.setUTCDate(startDay.getUTCDate() + idx);
      const dayStart = new Date(stamp);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(stamp);
      dayEnd.setUTCHours(23, 59, 59, 999);
      
      const dayValidations = filteredValidations.filter((vh) => {
        try {
          // Use UTC timestamp directly from Supabase
          const validationDate = new Date(vh.validated_at);
          if (isNaN(validationDate.getTime())) return false;
          const validationTime = validationDate.getTime();
          return validationTime >= dayStart.getTime() && validationTime <= dayEnd.getTime();
        } catch {
          return false;
        }
      });
      
      const aiValidated = dayValidations.filter((vh) => vh.status === "Validated").length;
      const aiCorrected = dayValidations.filter((vh) => vh.status === "Corrected").length;
      const totalValidations = dayValidations.length;
      const mismatchRate = totalValidations > 0 ? (aiCorrected / totalValidations) * 100 : 0;
      
      const dayLabel = WEEKDAY_FORMATTER.format(stamp);
      
      data.push({
        month: dayLabel,
        aiValidated,
        aiCorrected,
        mismatchRate: parseFloat(mismatchRate.toFixed(1)),
        totalValidations,
      });
    }
  } else {
    // Monthly or Custom: Group by month or day depending on range length
    const totalDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / ONE_DAY) + 1;
    
    if (totalDays <= 31) {
      // If less than a month, group by day
      const startDay = new Date(rangeStart);
      startDay.setUTCHours(0, 0, 0, 0);
      const endDay = new Date(rangeEnd);
      endDay.setUTCHours(0, 0, 0, 0);
      const buckets = totalDays;
      
      for (let idx = 0; idx < buckets; idx++) {
        const stamp = new Date(startDay);
        stamp.setUTCDate(startDay.getUTCDate() + idx);
        const dayStart = new Date(stamp);
        dayStart.setUTCHours(0, 0, 0, 0);
        const dayEnd = new Date(stamp);
        dayEnd.setUTCHours(23, 59, 59, 999);
        
        const dayValidations = filteredValidations.filter((vh) => {
          try {
            // Use UTC timestamp directly from Supabase
            const validationDate = new Date(vh.validated_at);
            if (isNaN(validationDate.getTime())) return false;
            const validationTime = validationDate.getTime();
            return validationTime >= dayStart.getTime() && validationTime <= dayEnd.getTime();
          } catch {
            return false;
          }
        });
        
        const aiValidated = dayValidations.filter((vh) => vh.status === "Validated").length;
        const aiCorrected = dayValidations.filter((vh) => vh.status === "Corrected").length;
        const totalValidations = dayValidations.length;
        const mismatchRate = totalValidations > 0 ? (aiCorrected / totalValidations) * 100 : 0;
        
        const dayLabel = DAY_FORMATTER.format(stamp);
        
        data.push({
          month: dayLabel,
          aiValidated,
          aiCorrected,
          mismatchRate: parseFloat(mismatchRate.toFixed(1)),
          totalValidations,
        });
      }
    } else {
      // If more than a month, group by month
      const startMonth = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1));
      const endMonth = new Date(Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), 1));
      
      const currentMonth = new Date(startMonth);
      while (currentMonth <= endMonth) {
        const monthStart = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), 1, 0, 0, 0, 0));
        const monthEnd = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 0, 23, 59, 59, 999));
        
        // Adjust for actual range boundaries
        const actualStart = monthStart < rangeStart ? rangeStart : monthStart;
        const actualEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;
        
        const monthValidations = filteredValidations.filter((vh) => {
          try {
            // Use UTC timestamp directly from Supabase
            const validationDate = new Date(vh.validated_at);
            if (isNaN(validationDate.getTime())) return false;
            const validationTime = validationDate.getTime();
            return validationTime >= actualStart.getTime() && validationTime <= actualEnd.getTime();
          } catch {
            return false;
          }
        });
        
        const aiValidated = monthValidations.filter((vh) => vh.status === "Validated").length;
        const aiCorrected = monthValidations.filter((vh) => vh.status === "Corrected").length;
        const totalValidations = monthValidations.length;
        const mismatchRate = totalValidations > 0 ? (aiCorrected / totalValidations) * 100 : 0;
        
        const monthLabel = currentMonth.toLocaleDateString("en-US", { month: "short" });
        
        data.push({
          month: monthLabel,
          aiValidated,
          aiCorrected,
          mismatchRate: parseFloat(mismatchRate.toFixed(1)),
          totalValidations,
        });
        
        // Move to next month
        currentMonth.setUTCMonth(currentMonth.getUTCMonth() + 1);
      }
    }
  }
  
  return data;
}

// Insight type
type Insight = {
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
};

// Generate insights based on data
function generateInsights(
  scans: Scan[],
  validationHistory: ValidationHistory[],
  appPerformance: AppPerformanceDatum[],
  diseaseDistribution: DistributionDatum[],
  ripenessDistribution: DistributionDatum[],
  monthlyMostScanned: MonthlyMostScannedDatum[]
): Insight[] {
  const insights: Insight[] = [];
  
  // 1. Analyze AI Accuracy trends - Highest and lowest months
  if (appPerformance.length >= 2) {
    const sortedByAccuracy = [...appPerformance].sort((a, b) => b.successRate - a.successRate);
    const highestMonth = sortedByAccuracy[0];
    const lowestMonth = sortedByAccuracy[sortedByAccuracy.length - 1];
    const latest = appPerformance[appPerformance.length - 1];
    const previous = appPerformance.length >= 2 ? appPerformance[appPerformance.length - 2] : null;
    
    // Check for significant accuracy decrease
    if (previous && previous.successRate - latest.successRate > 10) {
      insights.push({
        type: 'error',
        title: 'AI Accuracy Decline',
        description: `AI success rate decreased to ${latest.successRate.toFixed(1)}% in ${latest.month}; review model performance for disease detection.`,
        icon: TrendingDown,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
      });
    }
    
    // Highlight highest accuracy month
    if (highestMonth.successRate >= 90 && highestMonth.month !== latest.month) {
      insights.push({
        type: 'success',
        title: 'Peak Performance Month',
        description: `${highestMonth.month} recorded the highest AI accuracy at ${highestMonth.successRate.toFixed(1)}%.`,
        icon: TrendingUp,
        color: 'text-green-600',
        bgColor: 'bg-green-50',
      });
    }
    
    // Highlight lowest accuracy month if significantly low
    if (lowestMonth.successRate < 75 && lowestMonth.month !== latest.month) {
      insights.push({
        type: 'warning',
        title: 'Low Performance Period',
        description: `${lowestMonth.month} had the lowest AI accuracy at ${lowestMonth.successRate.toFixed(1)}%. Investigate potential causes.`,
        icon: AlertTriangle,
        color: 'text-orange-600',
        bgColor: 'bg-orange-50',
      });
    }
  }
  
  // 2. Most frequently scanned leaf diseases
  if (diseaseDistribution.length > 0) {
    const sortedDiseases = [...diseaseDistribution].sort((a, b) => b.value - a.value);
    const mostScannedDisease = sortedDiseases[0];
    const secondMostScanned = sortedDiseases.length > 1 ? sortedDiseases[1] : null;
    
    if (mostScannedDisease.value > 0) {
      // Check for significant increase in specific disease
      if (monthlyMostScanned.length >= 2) {
        const recentMonths = monthlyMostScanned.slice(-2);
        const currentMonthDisease = recentMonths[recentMonths.length - 1]?.mostScannedDisease;
        const previousMonthDisease = recentMonths[0]?.mostScannedDisease;
        const currentMonthCount = recentMonths[recentMonths.length - 1]?.leafDiseaseCount || 0;
        const previousMonthCount = recentMonths[0]?.leafDiseaseCount || 0;
        
        if (currentMonthDisease === previousMonthDisease && currentMonthCount > 0 && previousMonthCount > 0) {
          const increasePercent = ((currentMonthCount - previousMonthCount) / previousMonthCount) * 100;
          if (increasePercent > 15) {
            insights.push({
              type: 'warning',
              title: 'Disease Scan Increase',
              description: `${currentMonthDisease} scans increased by ${increasePercent.toFixed(0)}% this month compared to last month.`,
              icon: TrendingUp,
              color: 'text-orange-600',
              bgColor: 'bg-orange-50',
            });
          }
        }
      }
      
      // General insight about most scanned disease
      if (mostScannedDisease.value > 10 && (!secondMostScanned || mostScannedDisease.value > secondMostScanned.value * 1.5)) {
        insights.push({
          type: 'info',
          title: 'Most Scanned Disease',
          description: `${mostScannedDisease.name} is the most frequently scanned leaf disease with ${mostScannedDisease.value} cases.`,
          icon: Leaf,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
        });
      }
    }
  }
  
  // 3. Most frequently scanned fruit ripeness stages
  if (ripenessDistribution.length > 0) {
    const sortedRipeness = [...ripenessDistribution].sort((a, b) => b.value - a.value);
    const mostScannedRipeness = sortedRipeness[0];
    
    if (mostScannedRipeness.value > 0) {
      // Check recent ripeness patterns
      if (monthlyMostScanned.length >= 1) {
        const recentMonth = monthlyMostScanned[monthlyMostScanned.length - 1];
        if (recentMonth.mostScannedRipeness) {
          insights.push({
            type: 'info',
            title: 'Fruit Ripeness Pattern',
            description: `Most fruits scanned this ${monthlyMostScanned.length > 7 ? 'period' : 'week'} were ${recentMonth.mostScannedRipeness}, indicating ${recentMonth.mostScannedRipeness === 'Mature' ? 'peak harvest activity' : recentMonth.mostScannedRipeness === 'Overripe' ? 'late harvest stage' : 'early harvest stage'}.`,
            icon: Apple,
            color: 'text-blue-600',
            bgColor: 'bg-blue-50',
          });
        }
      }
    }
  }
  
  // 4. Scan volume trends - Sudden increases or decreases
  if (appPerformance.length >= 2) {
    const recent = appPerformance.slice(-2);
    const currentScans = recent[recent.length - 1].totalScans;
    const previousScans = recent[0].totalScans;
    
    if (previousScans > 0) {
      const scanChangePercent = ((currentScans - previousScans) / previousScans) * 100;
      
      if (scanChangePercent > 20) {
        insights.push({
          type: 'success',
          title: 'Scan Volume Increase',
          description: `Total scans increased by ${scanChangePercent.toFixed(0)}% compared to the previous period, showing growing engagement.`,
          icon: TrendingUp,
          color: 'text-green-600',
          bgColor: 'bg-green-50',
        });
      } else if (scanChangePercent < -20) {
        insights.push({
          type: 'warning',
          title: 'Scan Volume Decrease',
          description: `Total scans decreased by ${Math.abs(scanChangePercent).toFixed(0)}% compared to the previous period.`,
          icon: TrendingDown,
          color: 'text-orange-600',
          bgColor: 'bg-orange-50',
        });
      }
    }
  }
  
  // 5. Validation rate insights
  if (appPerformance.length >= 1) {
    const latest = appPerformance[appPerformance.length - 1];
    const validationRate = latest.totalScans > 0 ? (latest.validatedScans / latest.totalScans) * 100 : 0;
    
    if (validationRate < 50 && latest.totalScans > 10) {
      insights.push({
        type: 'warning',
        title: 'Low Validation Rate',
        description: `Only ${validationRate.toFixed(1)}% of scans have been validated. Consider increasing expert validation activity.`,
        icon: AlertCircle,
        color: 'text-orange-600',
        bgColor: 'bg-orange-50',
      });
    } else if (validationRate > 80 && latest.totalScans > 10) {
      insights.push({
        type: 'success',
        title: 'High Validation Rate',
        description: `${validationRate.toFixed(1)}% of scans have been validated, indicating strong expert engagement.`,
        icon: CheckCircle2,
        color: 'text-green-600',
        bgColor: 'bg-green-50',
      });
    }
  }
  
  // 6. Overall performance improvement trend
  if (appPerformance.length >= 3) {
    const recent = appPerformance.slice(-3);
    const isImproving = recent[recent.length - 1].successRate > recent[0].successRate;
    const improvement = recent[recent.length - 1].successRate - recent[0].successRate;
    
    if (isImproving && improvement > 5 && recent[recent.length - 1].successRate > 80) {
      insights.push({
        type: 'success',
        title: 'AI Performance Improving',
        description: `AI accuracy has improved by ${improvement.toFixed(1)}% over the last 3 months, reaching ${recent[recent.length - 1].successRate.toFixed(1)}% success rate.`,
        icon: TrendingUp,
        color: 'text-green-600',
        bgColor: 'bg-green-50',
      });
    }
  }
  
  // Return insights, prioritizing important ones (errors and warnings first)
  const sortedInsights = insights.sort((a, b) => {
    const priority = { 'error': 0, 'warning': 1, 'info': 2, 'success': 3 };
    return priority[a.type] - priority[b.type];
  });
  
  return sortedInsights.slice(0, 6); // Limit to 6 insights
}

export default function ReportsPage() {
  const { scans, validationHistory, loading, error, refreshData } = useData();
  const [range, setRange] = useState<Range>("today");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  
  // Fallback state for direct database fetching if DataContext is empty
  const [fallbackScans, setFallbackScans] = useState<Scan[]>([]);
  const [fallbackValidations, setFallbackValidations] = useState<ValidationHistory[]>([]);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [hasFetchedFallback, setHasFetchedFallback] = useState(false);

  // Direct database fetch - Always fetch directly from tables to ensure we have data
  useEffect(() => {
    const fetchDirectData = async () => {
      // Always fetch directly if we haven't fetched yet
      // This ensures we have data even if DataContext fails or is slow
      if (!hasFetchedFallback) {
        setFallbackLoading(true);
        setHasFetchedFallback(true);
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[Reports] 🔄 Starting direct database fetch from leaf_disease_scans and fruit_ripeness_scans...');
        }
        
        try {
          // Fetch from both tables directly
          const [leafScansResponse, fruitScansResponse, validationsResponse] = await Promise.all([
            supabase
              .from("leaf_disease_scans")
              .select("*")
              .order("created_at", { ascending: false }),
            supabase
              .from("fruit_ripeness_scans")
              .select("*")
              .order("created_at", { ascending: false }),
            supabase
              .from("validation_history")
              .select("*")
              .order("validated_at", { ascending: false }),
          ]);

          // Log errors but don't throw - we want to show whatever data we can get
          if (leafScansResponse.error) {
            console.error('[Reports] ❌ Error fetching leaf_disease_scans:', leafScansResponse.error);
          } else {
            console.log('[Reports] ✅ Successfully fetched leaf_disease_scans:', leafScansResponse.data?.length || 0, 'records');
          }
          
          if (fruitScansResponse.error) {
            console.error('[Reports] ❌ Error fetching fruit_ripeness_scans:', fruitScansResponse.error);
          } else {
            console.log('[Reports] ✅ Successfully fetched fruit_ripeness_scans:', fruitScansResponse.data?.length || 0, 'records');
          }
          
          if (validationsResponse.error) {
            console.error('[Reports] ❌ Error fetching validation_history:', validationsResponse.error);
          } else {
            console.log('[Reports] ✅ Successfully fetched validation_history:', validationsResponse.data?.length || 0, 'records');
          }

          // Transform leaf scans
          const leafScans: Scan[] = (leafScansResponse.data || []).map((scan: any) => ({
            ...scan,
            scan_type: 'leaf_disease' as const,
            ai_prediction: scan.disease_detected,
            solution: scan.solution,
            recommended_products: scan.recommendation,
          }));

          // Transform fruit scans
          const fruitScans: Scan[] = (fruitScansResponse.data || []).map((scan: any) => ({
            ...scan,
            scan_type: 'fruit_maturity' as const,
            ai_prediction: scan.ripeness_stage,
            solution: scan.harvest_recommendation,
            recommended_products: undefined,
          }));

          // Merge and sort
          const allScans = [...leafScans, ...fruitScans].sort((a, b) => {
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            return dateB - dateA;
          });

          // Transform validations
          const validations: ValidationHistory[] = (validationsResponse.data || []).map((vh: any) => ({
            ...vh,
            scan: allScans.find(s => s.scan_uuid === String(vh.scan_id).trim()),
          }));

          setFallbackScans(allScans);
          setFallbackValidations(validations);
          
          console.log('[Reports] 📊 Direct fetch completed:', {
            totalScans: allScans.length,
            leafScans: leafScans.length,
            fruitScans: fruitScans.length,
            validations: validations.length,
            hasErrors: !!(leafScansResponse.error || fruitScansResponse.error || validationsResponse.error),
            sampleScan: allScans.length > 0 ? {
              id: allScans[0].id,
              type: allScans[0].scan_type,
              created_at: allScans[0].created_at,
              status: allScans[0].status
            } : null
          });
        } catch (err) {
          console.error('[Reports] ❌ Error in direct fetch:', err);
          setFallbackLoading(false);
        } finally {
          setFallbackLoading(false);
        }
      }
    };

    fetchDirectData();
  }, [hasFetchedFallback]);

  // Use DataContext data if available, otherwise use fallback
  // Always prefer DataContext if it has data, but use fallback if DataContext is empty
  const safeScans = useMemo(() => {
    // Prefer DataContext if it has data, otherwise use fallback
    const scansArray = (Array.isArray(scans) && scans.length > 0) ? scans : fallbackScans;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[Reports] safeScans:', {
        total: scansArray.length,
        leaf: scansArray.filter(s => s.scan_type === 'leaf_disease').length,
        fruit: scansArray.filter(s => s.scan_type === 'fruit_maturity').length,
        loading: loading || fallbackLoading,
        error,
        source: (Array.isArray(scans) && scans.length > 0) ? 'DataContext' : 'DirectFetch',
        dataContextScans: Array.isArray(scans) ? scans.length : 0,
        fallbackScans: fallbackScans.length,
        sampleScan: scansArray.length > 0 ? {
          id: scansArray[0].id,
          type: scansArray[0].scan_type,
          created_at: scansArray[0].created_at,
          status: scansArray[0].status
        } : null
      });
    }
    return scansArray;
  }, [scans, fallbackScans, loading, fallbackLoading, error]);

  // Use DataContext validations if available, otherwise use fallback
  const safeValidations = useMemo(() => {
    return Array.isArray(validationHistory) && validationHistory.length > 0 
      ? validationHistory 
      : fallbackValidations;
  }, [validationHistory, fallbackValidations]);

  // Validate custom date range
  useEffect(() => {
    if (range === "custom" && customStartDate && customEndDate) {
      const start = new Date(customStartDate);
      const end = new Date(customEndDate);
      const today = new Date().toISOString().split('T')[0];
      
      // Ensure dates are not in the future
      if (customEndDate > today) {
        setCustomEndDate(today);
        return;
      }
      
      // Swap dates if start is after end (only if both dates are valid)
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start > end) {
        const temp = customStartDate;
        setCustomStartDate(customEndDate);
        setCustomEndDate(temp);
      }
    }
  }, [range, customStartDate, customEndDate]);

  const rangeStart = useMemo(() => {
    try {
      if (range === "custom" && customStartDate) {
        const customStart = new Date(customStartDate);
        if (!isNaN(customStart.getTime())) {
          return getRangeStart(range, customStart);
        }
      }
      return getRangeStart(range);
    } catch {
      // Fallback to today if date parsing fails
      const fallback = new Date();
      fallback.setUTCHours(0, 0, 0, 0);
      return fallback;
    }
  }, [range, customStartDate]);
  
  const rangeEnd = useMemo(() => {
    try {
      if (range === "custom" && customEndDate) {
        const customEnd = new Date(customEndDate);
        if (!isNaN(customEnd.getTime())) {
          return getRangeEnd(range, customEnd);
        }
      }
      return getRangeEnd(range);
    } catch {
      // Fallback to current time if date parsing fails
      return new Date();
    }
  }, [range, customEndDate]);

  // Format date range for display
  const dateRangeLabel = useMemo(() => {
    if (range === "custom" && customStartDate && customEndDate) {
      try {
        const start = new Date(customStartDate);
        const end = new Date(customEndDate);
        const startFormatted = start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const endFormatted = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        return `${startFormatted} - ${endFormatted}`;
      } catch {
        return RANGE_LABELS[range];
      }
    }
    return RANGE_LABELS[range];
  }, [range, customStartDate, customEndDate]);

  // Filter scans to exclude Unknown scans
  const allValidScans = useMemo(() => {
    if (!safeScans || safeScans.length === 0) {
      console.log('[Reports] ⚠️ allValidScans: No safeScans available', {
        safeScansLength: safeScans?.length || 0,
        safeScansType: Array.isArray(safeScans) ? 'array' : typeof safeScans
      });
      return [];
    }
    
    const valid = safeScans.filter((scan) => {
      if (!scan || !scan.id) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Reports] Filtering out scan - missing id:', scan);
        }
        return false;
      }
      if ((scan.status as string) === 'Unknown') {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Reports] Filtering out scan - Unknown status:', scan.id);
        }
        return false;
      }
      
      try {
        const result = getAiPrediction(scan);
        if (result && String(result).trim().toLowerCase() === 'unknown') {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Reports] Filtering out scan - Unknown result:', scan.id, result);
          }
          return false;
        }
      } catch {
        // Continue if getAiPrediction fails
      }
      
      return true;
    });
    
    console.log('[Reports] ✅ allValidScans filtered:', {
      inputTotal: safeScans.length,
      outputTotal: valid.length,
      leaf: valid.filter(s => s.scan_type === 'leaf_disease').length,
      fruit: valid.filter(s => s.scan_type === 'fruit_maturity').length,
      filteredOut: safeScans.length - valid.length,
      sampleValidScan: valid.length > 0 ? {
        id: valid[0].id,
        type: valid[0].scan_type,
        created_at: valid[0].created_at,
        status: valid[0].status
      } : null
    });
    
    return valid;
  }, [safeScans]);

  // Filter scans by date range
  const filteredScans = useMemo(() => {
    if (!allValidScans || allValidScans.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Reports] filteredScans: No allValidScans available');
      }
      return [];
    }
    
    // Log range boundaries for debugging
    if (process.env.NODE_ENV === 'development' && range === "today") {
      const today = new Date();
      const todayDate = today.toISOString().split("T")[0];
      console.log('[Reports] Today filter range boundaries:', {
        rangeStartUTC: rangeStart.toISOString(),
        rangeEndUTC: rangeEnd.toISOString(),
        todayDate
      });
    }
    
    const filtered = allValidScans.filter((scan) => {
      if (!scan.created_at) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Reports] Scan missing created_at:', scan.id);
        }
        return false;
      }
      
      try {
        // Use UTC timestamp directly from Supabase
        const scanDate = new Date(scan.created_at);
        if (isNaN(scanDate.getTime())) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Reports] Invalid scan date:', scan.created_at, scan.id);
          }
          return false;
        }
        
        if (range === "today") {
          // TODAY: Use LOCAL time boundaries to avoid timezone issues
          // This ensures scans created today in local time are correctly included
          const now = new Date();
          
          // Calculate local day boundaries correctly
          const startOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate()
          );
          
          const endOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            23, 59, 59, 999
          );
          
          // Filter using LOCAL time comparison
          // scanDate (from Supabase UTC timestamp) is automatically converted to local time
          return scanDate >= startOfToday && scanDate <= endOfToday;
        }
        
        if (range === "this_week") {
          // THIS WEEK: Monday 00:00 local → today 23:59:59 local
          const now = new Date();
          
          // Calculate Monday of current week in local time
          const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
          const diffToMonday = (dayOfWeek + 6) % 7; // Days to subtract to get Monday (0 if Monday)
          const monday = new Date(now);
          monday.setDate(now.getDate() - diffToMonday);
          monday.setHours(0, 0, 0, 0); // Start of Monday
          
          // End of today
          const endOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            23, 59, 59, 999
          );
          
          // Filter using LOCAL time comparison
          return scanDate >= monday && scanDate <= endOfToday;
        }
        
        if (range === "this_month") {
          // THIS MONTH: 1st day of month 00:00 local → today 23:59:59 local
          const now = new Date();
          
          // Start of current month in local time
          const startOfMonth = new Date(
            now.getFullYear(),
            now.getMonth(),
            1
          );
          
          // End of today
          const endOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            23, 59, 59, 999
          );
          
          // Filter using LOCAL time comparison
          return scanDate >= startOfMonth && scanDate <= endOfToday;
        }
        
        if (range === "custom" && customStartDate && customEndDate) {
          // Custom range: compare using UTC timestamps
          const scanTime = scanDate.getTime();
          const startTime = rangeStart.getTime();
          const endTime = rangeEnd.getTime();
          
          return scanTime >= startTime && scanTime <= endTime;
        }
        
        return false;
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Reports] Error filtering scan by date range:', scan.created_at, scan.id, error);
        }
        return false;
      }
    });
    
    console.log('[Reports] 📊 filteredScans result:', {
      range,
      total: filtered.length,
      leaf: filtered.filter(s => s.scan_type === 'leaf_disease').length,
      fruit: filtered.filter(s => s.scan_type === 'fruit_maturity').length,
      allValidScansCount: allValidScans.length,
      filteredOut: allValidScans.length - filtered.length,
      sampleFilteredScan: filtered.length > 0 ? {
        id: filtered[0].id,
        type: filtered[0].scan_type,
        created_at: filtered[0].created_at,
        scanDateUTC: filtered[0].created_at ? new Date(filtered[0].created_at).toISOString().split("T")[0] : 'N/A',
        today: new Date().toISOString().split("T")[0]
      } : null,
      sampleUnfilteredScan: allValidScans.length > 0 && filtered.length === 0 ? {
        id: allValidScans[0].id,
        type: allValidScans[0].scan_type,
        created_at: allValidScans[0].created_at,
        scanDateUTC: allValidScans[0].created_at ? new Date(allValidScans[0].created_at).toISOString().split("T")[0] : 'N/A',
        today: new Date().toISOString().split("T")[0]
      } : null
    });
    
    return filtered;
  }, [allValidScans, range, customStartDate, customEndDate]);

  const totalScansCount = useMemo(() => {
    if (!filteredScans || !Array.isArray(filteredScans)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Reports] filteredScans is not an array:', filteredScans);
      }
      return 0;
    }
    
    const count = filteredScans.length;
    
    if (process.env.NODE_ENV === 'development' && count > 0) {
      const leafCount = filteredScans.filter(s => s.scan_type === 'leaf_disease').length;
      const fruitCount = filteredScans.filter(s => s.scan_type === 'fruit_maturity').length;
      console.log(`[Reports] Total Scans (${range}):`, count, `(Leaf: ${leafCount}, Fruit: ${fruitCount})`);
    }
    
    return typeof count === 'number' && !isNaN(count) ? count : 0;
  }, [filteredScans, range]);


  const aiAccuracyRate = useMemo(() => {
    if (!safeValidations || safeValidations.length === 0) {
      return 0;
    }
    
    const filteredValidations = safeValidations.filter((vh) => {
      if (!vh?.validated_at) return false;
      
      if (vh.scan) {
        if ((vh.scan.status as string) === 'Unknown') return false;
        const result = getAiPrediction(vh.scan);
        if (result === 'Unknown') return false;
      }
      
      try {
        // Use UTC timestamp directly from Supabase
        const validationDate = new Date(vh.validated_at);
        if (isNaN(validationDate.getTime())) return false;
        
        if (range === "today") {
          // TODAY: Use LOCAL time boundaries to avoid timezone issues
          const now = new Date();
          
          // Calculate local day boundaries correctly
          const startOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate()
          );
          
          const endOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            23, 59, 59, 999
          );
          
          // Filter using LOCAL time comparison
          // validationDate (from Supabase UTC timestamp) is automatically converted to local time
          return validationDate >= startOfToday && validationDate <= endOfToday;
        }
        
        if (range === "this_week") {
          // THIS WEEK: Monday 00:00 local → today 23:59:59 local
          const now = new Date();
          
          // Calculate Monday of current week in local time
          const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
          const diffToMonday = (dayOfWeek + 6) % 7; // Days to subtract to get Monday (0 if Monday)
          const monday = new Date(now);
          monday.setDate(now.getDate() - diffToMonday);
          monday.setHours(0, 0, 0, 0); // Start of Monday
          
          // End of today
          const endOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            23, 59, 59, 999
          );
          
          // Filter using LOCAL time comparison
          return validationDate >= monday && validationDate <= endOfToday;
        }
        
        if (range === "this_month") {
          // THIS MONTH: 1st day of month 00:00 local → today 23:59:59 local
          const now = new Date();
          
          // Start of current month in local time
          const startOfMonth = new Date(
            now.getFullYear(),
            now.getMonth(),
            1
          );
          
          // End of today
          const endOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            23, 59, 59, 999
          );
          
          // Filter using LOCAL time comparison
          return validationDate >= startOfMonth && validationDate <= endOfToday;
        }
        
        if (range === "custom" && customStartDate && customEndDate) {
          // Custom range: compare using UTC timestamps
          const validationTime = validationDate.getTime();
          const startTime = rangeStart.getTime();
          const endTime = rangeEnd.getTime();
          return validationTime >= startTime && validationTime <= endTime;
        }
        
        return false;
      } catch {
        return false;
      }
    });
    
    const validatedCount = filteredValidations.filter((vh) => vh.status === "Validated").length;
    const correctedCount = filteredValidations.filter((vh) => vh.status === "Corrected").length;
    const total = validatedCount + correctedCount;
    
    if (total === 0) return 0;
    
    const rate = (validatedCount / total) * 100;
      return parseFloat(rate.toFixed(1));
  }, [safeValidations, range, customStartDate, customEndDate]);


  const validatedScansCount = useMemo(() => {
    if (!filteredScans || !Array.isArray(filteredScans) || filteredScans.length === 0) return 0;
    
    const validatedLeaf = filteredScans.filter((s) => {
      if (!s || !s.status || s.scan_type !== 'leaf_disease') return false;
      return s.status !== "Pending Validation";
    }).length;
    
    const validatedFruit = filteredScans.filter((s) => {
      if (!s || !s.status || s.scan_type !== 'fruit_maturity') return false;
      return s.status !== "Pending Validation";
    }).length;
    
    const totalValidated = validatedLeaf + validatedFruit;
    
    if (process.env.NODE_ENV === 'development' && totalValidated > 0) {
      console.log(`[Reports] Total Validated (${range}):`, totalValidated, `(Leaf: ${validatedLeaf}, Fruit: ${validatedFruit})`);
    }
    
    return typeof totalValidated === 'number' && !isNaN(totalValidated) ? totalValidated : 0;
  }, [filteredScans, range]);

  // Scan Trends - Filtered by selected range, updates in real-time
  // Uses filteredScans which respects the date range filter
  // Real-time updates: When new scans are added, filteredScans updates → scansTrend recalculates → chart re-renders
  const scansTrend = useMemo(() => {
    // Always call buildScansTrend - it handles empty states correctly
    // For daily range, it returns all 24 hours with 0 counts if no scans
    // For other ranges, it returns appropriate empty state
    return buildScansTrend(range, filteredScans || [], rangeStart, rangeEnd);
  }, [filteredScans, range, rangeStart, rangeEnd]);
  
  // App Performance - Always 12 months from all scans (not filtered by date range)
  // Includes validation history to calculate accurate AI Accuracy Rate
  const appPerformance = useMemo(() => {
    return buildAppPerformance(safeScans, safeValidations);
  }, [safeScans, safeValidations]);

  // Monthly Most Scanned - Last 12 months
  const monthlyMostScanned = useMemo(() => {
    return buildMonthlyMostScanned(safeScans);
  }, [safeScans]);

  // Expert Validation Performance - Filtered by selected range
  const expertValidationPerformance = useMemo(() => {
    if (!safeValidations || safeValidations.length === 0) return [];
    return buildExpertValidationPerformanceFiltered(range, safeValidations, rangeStart, rangeEnd);
  }, [safeValidations, range, rangeStart, rangeEnd]);

  // Most Scanned Categories (excludes Unknown - filteredScans already excludes Unknown)
  const mostScannedDiseases = useMemo(() => {
    const counts = new Map<string, number>();
    filteredScans
      .filter((scan) => scan.scan_type === "leaf_disease")
      .forEach((scan) => {
        const prediction = getAiPrediction(scan)?.trim() || '';
        // Skip empty predictions and Unknown results (additional safety check)
        if (prediction && prediction !== 'Unknown') {
          counts.set(prediction, (counts.get(prediction) || 0) + 1);
        }
      });
    
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [filteredScans]);

  const mostScannedRipeness = useMemo(() => {
    const counts = new Map<string, number>();
    filteredScans
      .filter((scan) => scan.scan_type === "fruit_maturity")
      .forEach((scan) => {
        const prediction = getAiPrediction(scan)?.trim() || '';
        // Skip empty predictions and Unknown results (additional safety check)
        if (prediction && prediction !== 'Unknown') {
          counts.set(prediction, (counts.get(prediction) || 0) + 1);
        }
      });
    
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [filteredScans]);

  // Leaf Disease Distribution - Updates in real-time via filteredScans dependency
  // Uses UTC timestamps directly from Supabase (no timezone conversion)
  // Real-time updates: When new scans are added/updated, filteredScans updates → distribution recalculates → chart re-renders
  const diseaseDistribution = useMemo((): DistributionDatum[] => {
    const counts = new Map<string, number>();
    
    // Initialize all disease types (excluding Unknown)
    // These match the DISEASE_COLORS mapping for consistent color coding
    const diseaseTypes = ["Cercospora", "Yellow Mosaic Virus", "Healthy", "Fusarium Wilt", "Downy Mildew"];
    diseaseTypes.forEach(type => counts.set(type, 0));
    
    if (!filteredScans || filteredScans.length === 0) {
      // Return all zero counts if no scans
      // Chart will automatically update when filteredScans changes (via real-time subscriptions)
      return diseaseTypes.map((name) => ({
        name,
        value: 0,
      }));
    }
    
    // Filter for leaf disease scans only from leaf_disease_scans table using type guard
    // Type-safe filtering ensures we only process leaf disease scans
    const leafDiseaseScans = filteredScans.filter(isLeafDiseaseScan);
    
    // Helper function to normalize disease name for consistent matching
    const normalizeDiseaseName = (diseaseName: string): string | null => {
      if (!diseaseName) return null;
      
      const normalized = String(diseaseName).trim().toLowerCase().replace(/\s+/g, ' ');
      
      // Skip Unknown results (case-insensitive)
      if (normalized === 'unknown' || normalized === '' || normalized === 'n/a' || normalized === 'null') {
        return null;
      }
      
      // Map to standard disease names (case-insensitive matching with flexible patterns)
      if (normalized === "cercospora" || normalized.includes("cercospora")) {
        return "Cercospora";
      }
      if (normalized === "yellow mosaic virus" || 
          normalized === "yellow mosaic" ||
          (normalized.includes("yellow") && normalized.includes("mosaic"))) {
        return "Yellow Mosaic Virus";
      }
      if (normalized === "healthy" || normalized.includes("healthy")) {
        return "Healthy";
      }
      if (normalized === "fusarium wilt" || 
          normalized === "fusarium" ||
          (normalized.includes("fusarium") && normalized.includes("wilt")) ||
          (normalized.includes("fusarium") && !normalized.includes("dry"))) {
        return "Fusarium Wilt";
      }
      if (normalized === "downy mildew" || 
          normalized === "downy" ||
          (normalized.includes("downy") && normalized.includes("mildew")) ||
          (normalized.includes("downy") && !normalized.includes("powdery")) ||
          (normalized.includes("mildew") && !normalized.includes("powdery"))) {
        return "Downy Mildew";
      }
      
      return null;
    };
    
    // Aggregate counts for each disease type from leaf_disease_scans
    // Process all leaf disease scans and group them by disease_detected
    // Real-time updates: When new scans are added, filteredScans updates, triggering recalculation
    leafDiseaseScans.forEach((scan) => {
      try {
        // Type-safe access: scan is narrowed to LeafDiseaseScan by type guard
        // Access disease_detected directly from the typed scan
        let diseaseDetected: string | null | undefined = scan.disease_detected;
        
        // Fallback to getAiPrediction if disease_detected is empty
        if (!diseaseDetected || (typeof diseaseDetected === 'string' && diseaseDetected.trim() === '')) {
          diseaseDetected = getAiPrediction(scan);
        }
        
        // Skip if still empty or null/undefined
        if (!diseaseDetected || (typeof diseaseDetected === 'string' && diseaseDetected.trim() === '')) {
          return;
        }
        
        const diseaseStr = String(diseaseDetected).trim();
        if (!diseaseStr) return;
        
        // Normalize and match disease name
        const normalizedDisease = normalizeDiseaseName(diseaseStr);
        
        // Skip if disease name couldn't be normalized or is Unknown
        if (!normalizedDisease) {
          return;
        }
        
        // Increment count for matched disease type
        counts.set(normalizedDisease, (counts.get(normalizedDisease) || 0) + 1);
      } catch (error) {
        // Skip on error - don't count invalid scans
        if (process.env.NODE_ENV === 'development') {
          console.debug('[Disease Distribution] Error processing scan:', error, {
            scanId: scan?.id,
            scanType: scan?.scan_type
          });
        }
      }
    });
    
    // Return in specific order with all items (even if 0), excluding Unknown
    // This ensures the chart always shows all disease types even if they have 0 counts
    // Real-time update flow:
    // 1. New scan added → DataContext updates scans state via Supabase Realtime (INSERT/UPDATE)
    // 2. allValidScans recalculates (excludes only Unknown)
    // 3. filteredScans recalculates (applies date filter using UTC timestamps)
    // 4. diseaseDistribution recalculates → Chart re-renders with new data
    return diseaseTypes.map((name) => ({
      name,
      value: counts.get(name) || 0,
    }));
  }, [filteredScans]);

  // Fruit Ripeness Distribution - Updates in real-time via filteredScans dependency
  // Uses UTC timestamps directly from Supabase (no timezone conversion)
  // Real-time updates: When new scans are added/updated, filteredScans updates → distribution recalculates → chart re-renders
  const ripenessDistribution = useMemo((): DistributionDatum[] => {
    const counts = new Map<string, number>();
    
    // Initialize all ripeness types (excluding Unknown)
    const ripenessTypes = ["Immature", "Mature", "Overmature", "Overripe"];
    ripenessTypes.forEach(type => counts.set(type, 0));
    
    if (!filteredScans || filteredScans.length === 0) {
      // Return all zero counts if no scans
      // Chart will automatically update when filteredScans changes (via real-time subscriptions)
      return ripenessTypes.map((name) => ({
        name,
        value: 0,
      }));
    }
    
    // Filter for fruit ripeness scans only from fruit_ripeness_scans table using type guard
    // Type-safe filtering ensures we only process fruit ripeness scans
    const fruitRipenessScans = filteredScans.filter(isFruitRipenessScan);
    
    // Aggregate counts for each ripeness stage from fruit_ripeness_scans
    // Process all fruit ripeness scans and group them by ripeness_stage
    // Real-time updates: When new scans are added, filteredScans updates, triggering recalculation
    fruitRipenessScans.forEach((scan) => {
      try {
        // Type-safe access: scan is narrowed to FruitRipenessScan by type guard
        // Access ripeness_stage directly from the typed scan
        let ripenessStage: string | null | undefined = scan.ripeness_stage;
        
        // Fallback to getAiPrediction if ripeness_stage is empty
        if (!ripenessStage || (typeof ripenessStage === 'string' && ripenessStage.trim() === '')) {
          ripenessStage = getAiPrediction(scan);
        }
        
        // Skip if still empty or null/undefined
        if (!ripenessStage || (typeof ripenessStage === 'string' && ripenessStage.trim() === '')) {
          return;
        }
        
        const predictionStr = String(ripenessStage).trim();
        
        // Skip empty predictions and Unknown results (case-insensitive)
        if (!predictionStr || 
            predictionStr.toLowerCase() === 'unknown' || 
            predictionStr.toLowerCase() === 'n/a' ||
            predictionStr.toLowerCase() === 'null') {
          return;
        }
        
        // Normalize prediction for matching (case-insensitive)
        const normalized = predictionStr.toLowerCase();
        
        // Exact or partial matching with priority (check longer matches first)
        if (normalized === "overmature" || normalized.includes("overmature")) {
          counts.set("Overmature", (counts.get("Overmature") || 0) + 1);
        } else if (normalized === "overripe" || normalized.includes("overripe")) {
          counts.set("Overripe", (counts.get("Overripe") || 0) + 1);
        } else if (normalized === "immature" || normalized.includes("immature")) {
          counts.set("Immature", (counts.get("Immature") || 0) + 1);
        } else if (normalized === "mature" || (normalized.includes("mature") && !normalized.includes("over"))) {
          counts.set("Mature", (counts.get("Mature") || 0) + 1);
        }
        // Unknown/unmatched cases are skipped
      } catch (error) {
        // Skip on error - don't count invalid scans
        if (process.env.NODE_ENV === 'development') {
          console.debug('[Ripeness Distribution] Error processing scan:', error, {
            scanId: scan?.id,
            scanType: scan?.scan_type
          });
        }
      }
    });
    
    // Return in specific order with all items (even if 0), excluding Unknown
    // This ensures the chart always shows all ripeness types even if they have 0 counts
    // Real-time update flow:
    // 1. New scan added → DataContext updates scans state via Supabase Realtime (INSERT/UPDATE)
    // 2. allValidScans recalculates (excludes only Unknown)
    // 3. filteredScans recalculates (applies date filter using UTC timestamps)
    // 4. ripenessDistribution recalculates → Chart re-renders with new data
    return ripenessTypes.map((name) => ({
      name,
      value: counts.get(name) || 0,
    }));
  }, [filteredScans]);

  // Generate insights - after all data is calculated
  const insights = useMemo(() => {
    return generateInsights(safeScans, safeValidations || [], appPerformance, diseaseDistribution, ripenessDistribution, monthlyMostScanned);
  }, [safeScans, safeValidations, appPerformance, diseaseDistribution, ripenessDistribution, monthlyMostScanned]);

  // Build monthly scans summary (Jan-Dec) for report export
  const monthlyScansSummary = useMemo(() => {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const months: Array<{
      month: string;
      totalScans: number;
      validatedScans: number;
      successRate: number;
      aiAccuracy: number;
    }> = [];

    // Generate all 12 months of current year
    for (let i = 0; i < 12; i++) {
      // Calculate month in UTC
      const monthDate = new Date(Date.UTC(currentYear, i, 1));
      const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });
      
      // Calculate month boundaries in UTC
      const monthStart = new Date(Date.UTC(currentYear, i, 1, 0, 0, 0, 0));
      const monthEnd = new Date(Date.UTC(currentYear, i + 1, 0, 23, 59, 59, 999));

      // Filter scans for this month
      const monthScans = safeScans.filter((scan) => {
        if ((scan.status as string) === 'Unknown') return false;
        const result = getAiPrediction(scan);
        if (result === 'Unknown') return false;
        if (!scan?.created_at) return false;
        try {
          // Use UTC timestamp directly from Supabase
          const scanDate = new Date(scan.created_at);
          if (isNaN(scanDate.getTime())) return false;
          
          // Compare in UTC (using date string for date comparison)
          const scanDateStr = scanDate.toISOString().split("T")[0];
          const monthStartStr = monthStart.toISOString().split("T")[0];
          const monthEndStr = monthEnd.toISOString().split("T")[0];
          return scanDateStr >= monthStartStr && scanDateStr <= monthEndStr;
        } catch {
          return false;
        }
      });

      const totalScans = monthScans.length;
      const validatedScans = monthScans.filter((s) => s.status !== "Pending Validation").length;
      const successRate = totalScans > 0 ? (validatedScans / totalScans) * 100 : 0;

      // Calculate AI Accuracy for this month
      const monthValidations = (safeValidations || []).filter((vh) => {
        if (!vh?.validated_at) return false;
        try {
          // Use UTC timestamp directly from Supabase
          const validationDate = new Date(vh.validated_at);
          if (isNaN(validationDate.getTime())) return false;
          
          // Compare in UTC (using date string for date comparison)
          const validationDateStr = validationDate.toISOString().split("T")[0];
          const monthStartStr = monthStart.toISOString().split("T")[0];
          const monthEndStr = monthEnd.toISOString().split("T")[0];
          return validationDateStr >= monthStartStr && validationDateStr <= monthEndStr;
        } catch {
          return false;
        }
      });

      const aiValidated = monthValidations.filter((vh) => vh.status === "Validated").length;
      const aiCorrected = monthValidations.filter((vh) => vh.status === "Corrected").length;
      const totalValidations = aiValidated + aiCorrected;
      const aiAccuracy = totalValidations > 0 ? (aiValidated / totalValidations) * 100 : 0;

      months.push({
        month: monthName,
        totalScans,
        validatedScans,
        successRate: parseFloat(successRate.toFixed(1)),
        aiAccuracy: parseFloat(aiAccuracy.toFixed(1)),
      });
    }

    return months;
  }, [safeScans, safeValidations]);

  // Calculate Success Rate for KPI
  const successRate = useMemo(() => {
    if (totalScansCount === 0) return 0;
    return parseFloat(((validatedScansCount / totalScansCount) * 100).toFixed(1));
  }, [totalScansCount, validatedScansCount]);

  // Expert Validation Performance Summary
  const expertValidationSummary = useMemo(() => {
    const filteredValidations = (safeValidations || []).filter((vh) => {
      if (!vh?.validated_at) return false;
      if (vh.scan) {
        if ((vh.scan.status as string) === 'Unknown') return false;
        const result = getAiPrediction(vh.scan);
        if (result === 'Unknown') return false;
      }
      try {
        // Use UTC timestamp directly from Supabase
        const validationDate = new Date(vh.validated_at);
        if (isNaN(validationDate.getTime())) return false;
        const validationTime = validationDate.getTime();
        const rangeStartTime = rangeStart.getTime();
        let rangeEndTime = rangeEnd.getTime();
        if (range === "this_week" || range === "this_month") {
          rangeEndTime = new Date().getTime();
        }
        return validationTime >= rangeStartTime && validationTime <= rangeEndTime;
      } catch {
        return false;
      }
    });

    const aiCorrect = filteredValidations.filter((vh) => vh.status === "Validated").length;
    const aiIncorrect = filteredValidations.filter((vh) => vh.status === "Corrected").length;

    return {
      aiCorrect,
      aiIncorrect,
      total: aiCorrect + aiIncorrect,
    };
  }, [safeValidations, rangeStart, rangeEnd, range]);

  // Generate CSV Export
  const generateCSV = useCallback(() => {
    const rows: string[] = [];

    // Report Header
    rows.push('BitterScan Performance Report');
    rows.push('');
    rows.push(`Date Range,${dateRangeLabel}`);
    rows.push(`Generated By,Expert Dashboard`);
    rows.push(`Generated On,${new Date().toISOString()}`);
    rows.push('');

    // Report Overview Table
    rows.push('Report Overview');
    rows.push('Metric,Value');
    rows.push(`Total Scans,${totalScansCount}`);
    rows.push(`Total Validated,${validatedScansCount}`);
    rows.push(`AI Accuracy Rate,${aiAccuracyRate}%`);
    rows.push(`Success Rate,${successRate}%`);
    rows.push('');

    // Scans Summary Table (Monthly)
    rows.push('Scans Summary (Monthly)');
    rows.push('Month,Total Scans,Validated Scans,Success Rate (%),AI Accuracy (%)');
    monthlyScansSummary.forEach((month) => {
      rows.push(`${month.month},${month.totalScans},${month.validatedScans},${month.successRate},${month.aiAccuracy}`);
    });
    rows.push('');

    // Leaf Disease Distribution
    rows.push('Leaf Disease Distribution');
    rows.push('Disease,Count');
    diseaseDistribution.forEach((item) => {
      rows.push(`${item.name},${item.value}`);
    });
    rows.push('');

    // Fruit Ripeness Distribution
    rows.push('Fruit Ripeness Distribution');
    rows.push('Ripeness,Count');
    ripenessDistribution.forEach((item) => {
      rows.push(`${item.name},${item.value}`);
    });
    rows.push('');

    // Monthly Most Scanned Categories
    rows.push('Monthly Most Scanned Categories');
    rows.push('Category,Count');
    monthlyMostScanned.forEach((month) => {
      if (month.mostScannedDisease) {
        rows.push(`${month.mostScannedDisease} (${month.month}),${month.leafDiseaseCount}`);
      }
      if (month.mostScannedRipeness) {
        rows.push(`${month.mostScannedRipeness} (${month.month}),${month.fruitRipenessCount}`);
      }
    });
    rows.push('');

    // Expert Validation Performance
    rows.push('Expert Validation Performance');
    rows.push('Result,Count');
    rows.push(`AI Correct,${expertValidationSummary.aiCorrect}`);
    rows.push(`AI Incorrect,${expertValidationSummary.aiIncorrect}`);
    rows.push('');

    // Insights
    rows.push('Insights');
    rows.push('Description');
    insights.forEach((insight) => {
      rows.push(`${insight.title}: ${insight.description}`);
    });

    // Create CSV content with proper escaping
    const csvContent = rows.map((row) => {
      // Escape commas and quotes in CSV
      return row.split(',').map((cell) => {
        if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }).join(',');
    }).join('\n');

    // Add BOM for UTF-8 Excel compatibility
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bitterscan-performance-report-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('CSV report exported successfully');
  }, [
    dateRangeLabel,
    totalScansCount,
    validatedScansCount,
    aiAccuracyRate,
    successRate,
    monthlyScansSummary,
    diseaseDistribution,
    ripenessDistribution,
    monthlyMostScanned,
    expertValidationSummary,
    insights,
  ]);

  // Generate PDF Export
  const generatePDF = useCallback(() => {
    if (typeof window === 'undefined') return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow popups to generate PDF');
      return;
    }

    const currentDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const reportDate = dateRangeLabel;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>BitterScan Performance Report</title>
  <style>
    @page {
      margin: 1cm;
      size: A4;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 20px;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #388E3C;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      color: #388E3C;
      font-size: 24pt;
      margin: 0 0 10px 0;
      font-weight: bold;
    }
    .header-info {
      display: flex;
      justify-content: space-between;
      margin-top: 15px;
      font-size: 10pt;
      color: #666;
    }
    .section {
      margin-bottom: 30px;
      page-break-inside: avoid;
    }
    .section-title {
      background-color: #388E3C;
      color: white;
      padding: 10px 15px;
      font-size: 14pt;
      font-weight: bold;
      margin-bottom: 15px;
      border-radius: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 10pt;
    }
    table th {
      background-color: #f5f5f5;
      border: 1px solid #ddd;
      padding: 10px;
      text-align: left;
      font-weight: bold;
      color: #333;
    }
    table td {
      border: 1px solid #ddd;
      padding: 8px 10px;
    }
    table tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    .insights {
      background-color: #f0f9ff;
      border-left: 4px solid #388E3C;
      padding: 15px;
      margin-top: 20px;
    }
    .insights h3 {
      margin-top: 0;
      color: #388E3C;
      font-size: 12pt;
    }
    .insights ul {
      margin: 10px 0;
      padding-left: 20px;
    }
    .insights li {
      margin-bottom: 8px;
    }
    @media print {
      body {
        padding: 0;
      }
      .section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>BitterScan Performance Report</h1>
    <div class="header-info">
      <div><strong>Date Range:</strong> ${reportDate}</div>
      <div><strong>Generated By:</strong> Expert Dashboard</div>
      <div><strong>Generated On:</strong> ${currentDate}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Report Overview</div>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Total Scans</td>
          <td>${totalScansCount.toLocaleString()}</td>
        </tr>
        <tr>
          <td>Total Validated</td>
          <td>${validatedScansCount.toLocaleString()}</td>
        </tr>
        <tr>
          <td>AI Accuracy Rate</td>
          <td>${aiAccuracyRate}%</td>
        </tr>
        <tr>
          <td>Success Rate</td>
          <td>${successRate}%</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Scans Summary (Monthly)</div>
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th>Total Scans</th>
          <th>Validated Scans</th>
          <th>Success Rate (%)</th>
          <th>AI Accuracy (%)</th>
        </tr>
      </thead>
      <tbody>
        ${monthlyScansSummary.map((month) => `
        <tr>
          <td>${month.month}</td>
          <td>${month.totalScans}</td>
          <td>${month.validatedScans}</td>
          <td>${month.successRate}</td>
          <td>${month.aiAccuracy}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Leaf Disease Distribution</div>
    <table>
      <thead>
        <tr>
          <th>Disease</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        ${diseaseDistribution.map((item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.value}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Fruit Ripeness Distribution</div>
    <table>
      <thead>
        <tr>
          <th>Ripeness</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        ${ripenessDistribution.map((item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.value}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Monthly Most Scanned Categories</div>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        ${monthlyMostScanned.map((month) => {
          const rows: string[] = [];
          if (month.mostScannedDisease) {
            rows.push(`<tr><td>${month.mostScannedDisease} (${month.month})</td><td>${month.leafDiseaseCount}</td></tr>`);
          }
          if (month.mostScannedRipeness) {
            rows.push(`<tr><td>${month.mostScannedRipeness} (${month.month})</td><td>${month.fruitRipenessCount}</td></tr>`);
          }
          return rows.join('');
        }).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Expert Validation Performance</div>
    <table>
      <thead>
        <tr>
          <th>Result</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>AI Correct</td>
          <td>${expertValidationSummary.aiCorrect}</td>
        </tr>
        <tr>
          <td>AI Incorrect</td>
          <td>${expertValidationSummary.aiIncorrect}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="insights">
    <h3>Insights & Recommendations</h3>
    <ul>
      ${insights.map((insight) => `<li><strong>${insight.title}:</strong> ${insight.description}</li>`).join('')}
    </ul>
  </div>
</body>
</html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    
    // Wait for content to load, then print
    setTimeout(() => {
      printWindow.print();
      toast.success('PDF report generated. Use browser print dialog to save as PDF.');
    }, 250);
  }, [
    dateRangeLabel,
    totalScansCount,
    validatedScansCount,
    aiAccuracyRate,
    successRate,
    monthlyScansSummary,
    diseaseDistribution,
    ripenessDistribution,
    monthlyMostScanned,
    expertValidationSummary,
    insights,
  ]);

  const isLoading = loading || fallbackLoading;
  
  if (isLoading) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <Loader2 className="h-12 w-12 animate-spin text-gray-500 mx-auto mb-4" />
              <p className="text-gray-600">Loading reports...</p>
            </div>
          </div>
        </AppShell>
      </AuthGuard>
    );
  }

  if (error) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-red-600 font-medium mb-4">{error}</p>
              <Button variant="outline" onClick={() => refreshData(true)}>
                Try Again
              </Button>
            </div>
          </div>
        </AppShell>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header Section with Title */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Reports &amp; Analytics</h1>
            <p className="text-gray-600 text-base">Comprehensive insights into scan activity and AI performance</p>
          </div>

          {/* Filters and Export Buttons Row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6">
            {/* Date Range Filter Section - Left Side */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
              {RANGE_OPTIONS.filter(opt => opt.value !== "custom").map((option) => (
                <Button
                  key={option.value}
                  variant={range === option.value ? "default" : "ghost"}
                  size="sm"
                  className={`text-sm font-medium transition-colors ${
                    range === option.value 
                      ? "bg-[#388E3C] text-white hover:bg-[#2F7A33]" 
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                  onClick={() => {
                    setRange(option.value);
                    setShowCustomPicker(false);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <Button
              variant={range === "custom" ? "default" : "outline"}
              size="sm"
              className={`text-sm font-medium transition-colors ${
                range === "custom" 
                  ? "bg-[#388E3C] text-white hover:bg-[#2F7A33]" 
                  : "border-gray-300 hover:bg-gray-50"
              }`}
              onClick={() => {
                setRange("custom");
                setShowCustomPicker(true);
                if (!customStartDate || !customEndDate) {
                  const today = new Date();
                  const weekAgo = new Date(today);
                  weekAgo.setDate(today.getDate() - 7);
                  setCustomStartDate(weekAgo.toISOString().split('T')[0]);
                  setCustomEndDate(today.toISOString().split('T')[0]);
                }
              }}
            >
              <Calendar className="h-4 w-4 mr-1.5" />
              Custom
            </Button>
            {showCustomPicker && range === "custom" && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-colors"
                  max={customEndDate || new Date().toISOString().split('T')[0]}
                />
                <span className="text-gray-500 font-medium text-sm">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-colors"
                  min={customStartDate || undefined}
                  max={new Date().toISOString().split('T')[0]}
                />
                {customStartDate && customEndDate && (
                  <span className="text-xs text-gray-600 font-medium ml-1">
                    ({dateRangeLabel})
                  </span>
                )}
              </div>
            )}
            </div>
            {/* Export Buttons Section - Right Side */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={generateCSV}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <Button
                size="sm"
                onClick={generatePDF}
                className="flex items-center gap-2 text-white bg-[#388E3C] border-[#388E3C] hover:bg-[#2F7A33] hover:border-[#2F7A33] transition-colors"
              >
                <Download className="h-4 w-4" />
                Export PDF
              </Button>
            </div>
          </div>

          {/* KPI Cards Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6 mb-2">
            {[
              {
                icon: TrendingUp,
                label: "AI Accuracy Rate",
                value: `${typeof aiAccuracyRate === 'number' ? aiAccuracyRate : 0}%`,
                color: "text-green-600",
              },
              {
                icon: Camera,
                label: "Total Scans",
                value: (typeof totalScansCount === 'number' ? totalScansCount : 0).toLocaleString("en-US"),
                color: "text-green-600",
              },
              {
                icon: CheckCircle2,
                label: "Total Validated",
                value: (typeof validatedScansCount === 'number' ? validatedScansCount : 0).toLocaleString("en-US"),
                color: "text-green-600",
              },
            ].map((metric, idx) => {
              const Icon = metric.icon;
              return (
                <Card key={idx}>
                  <CardHeader className="pb-2">
                    <CardTitle>{metric.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <p className="text-3xl font-semibold">{metric.value}</p>
                    <Icon className={`h-8 w-8 ${metric.color} flex-shrink-0`} />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Scan Trends Chart - Filtered by selected range */}
          <Card className="bg-white shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 rounded-xl overflow-hidden">
            <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
              <CardTitle className="text-xl font-bold text-white">
                Scans Trend
              </CardTitle>
              <p className="text-sm text-white/90 mt-1">Analysis for {dateRangeLabel.toLowerCase()}</p>
            </CardHeader>
            <CardContent className="pt-6 px-6 pb-6">
              {scansTrend.length > 0 ? (
                <div className="w-full" style={{ minHeight: '300px' }}>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart 
                      data={scansTrend} 
                      margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                      <XAxis 
                        dataKey="period" 
                        stroke="#6B7280" 
                        fontSize={12} 
                        tick={{ fill: "#374151", fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                        angle={range === "today" ? 0 : -45}
                        textAnchor={range === "today" ? "middle" : "end"}
                        height={range === "today" ? 30 : 60}
                      />
                      <YAxis 
                        stroke="#6B7280" 
                        fontSize={12} 
                        tick={{ fill: "#6B7280", fontWeight: 500 }} 
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => {
                          return value.toString();
                        }}
                        width={60}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#FFFFFF",
                          border: "1px solid #E5E7EB",
                          borderRadius: "8px",
                          fontSize: "12px",
                          padding: "10px 14px",
                          color: "#1F2937",
                          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                        }}
                        formatter={(value: number, name: string) => [
                          `${value.toLocaleString("en-US")} scans`,
                          name
                        ]}
                        labelFormatter={(label) => `Time: ${label}`}
                        cursor={{ stroke: "#388E3C", strokeWidth: 1, strokeDasharray: "5 5" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="scans"
                        stroke="#388E3C"
                        strokeWidth={3}
                        dot={{ fill: "#388E3C", r: 4, strokeWidth: 2, stroke: "#FFFFFF" }}
                        activeDot={{ r: 6, fill: "#2F7A33", strokeWidth: 2, stroke: "#FFFFFF" }}
                        name="Scans"
                        isAnimationActive={true}
                        animationDuration={800}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50">
                  <p className="font-medium text-gray-500">No scan trend data for {RANGE_LABELS[range].toLowerCase()} yet.</p>
                  <p className="mt-1 text-xs text-gray-400">New scans will populate this chart automatically.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Disease and Ripeness Distribution Sections - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Leaf Disease Distribution Section */}
            <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden" data-chart="diseaseDistribution">
              <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
                <CardTitle className="text-xl font-bold text-white">
                  Leaf Disease Distribution
                </CardTitle>
                <p className="text-sm text-white/90 mt-1">Analysis for {dateRangeLabel.toLowerCase()}</p>
              </CardHeader>
              <CardContent className="pt-3 px-6 pb-3">
                {(() => {
                  // Filter to only show diseases with values > 0 for chart display
                  // This ensures the chart only shows relevant data
                  const chartData = diseaseDistribution.filter((item) => item.value > 0);
                  const hasData = chartData.length > 0;
                  const totalScans = diseaseDistribution.reduce((sum, item) => sum + item.value, 0);
                  
                  // Debug: Log chart rendering state in development
                  if (process.env.NODE_ENV === 'development') {
                    console.debug('[Disease Distribution Chart] Rendering state:', {
                      hasData,
                      chartDataLength: chartData.length,
                      chartData,
                      totalDistribution: diseaseDistribution,
                      totalScans,
                      filteredScansCount: filteredScans.filter(s => s.scan_type === 'leaf_disease').length
                    });
                  }
                  
                  return hasData ? (
                    <>
                      <div className="mb-3">
                        <div className="flex items-center justify-center w-full overflow-hidden" style={{ minHeight: '180px' }}>
                          <ResponsiveContainer width="100%" height={180}>
                            <RechartsPieChart>
                              <Pie
                                data={chartData}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ value, cx, cy, midAngle, innerRadius, outerRadius }) => {
                                  if (midAngle === undefined || cx === undefined || cy === undefined || innerRadius === undefined || outerRadius === undefined) {
                                    return null;
                                  }
                                  const RADIAN = Math.PI / 180;
                                  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                                  const x = cx + radius * Math.cos(-midAngle * RADIAN);
                                  const y = cy + radius * Math.sin(-midAngle * RADIAN);
                                  return (
                                    <text 
                                      x={x} 
                                      y={y} 
                                      fill="#1F2937" 
                                      textAnchor={x > cx ? 'start' : 'end'} 
                                      dominantBaseline="central"
                                      fontSize={12}
                                      fontWeight={700}
                                    >
                                      {value.toLocaleString("en-US")}
                                    </text>
                                  );
                                }}
                                innerRadius={50}
                                outerRadius={75}
                                fill="#8884d8"
                                dataKey="value"
                                animationBegin={0}
                                animationDuration={800}
                              >
                                {chartData.map((entry) => (
                                  <Cell 
                                    key={`disease-cell-${entry.name}`} 
                                    fill={DISEASE_COLORS[entry.name] || "#388E3C"}
                                    stroke="#FFFFFF"
                                    strokeWidth={3}
                                  />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(value: number, name: string) => [
                                  `${value.toLocaleString("en-US")} cases`,
                                  name
                                ]}
                                contentStyle={{
                                  backgroundColor: "#FFFFFF",
                                  border: "1px solid #E5E7EB",
                                  borderRadius: "8px",
                                  fontSize: "13px",
                                  padding: "10px 14px",
                                  color: "#1F2937",
                                  fontWeight: 600,
                                  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                                }}
                              />
                              <Legend
                                iconType="circle"
                                wrapperStyle={{ 
                                  fontSize: "12px", 
                                  paddingTop: "12px", 
                                  color: "#374151", 
                                  fontWeight: 600 
                                }}
                                formatter={(value: string) => value}
                                layout="horizontal"
                                verticalAlign="bottom"
                              />
                            </RechartsPieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    
                    {/* Data Table */}
                    <div className="mt-3 border-t border-gray-200 pt-3">
                      <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Distribution Details</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b-2 border-gray-300 bg-gray-50">
                              <th className="text-left py-2.5 px-3 font-semibold text-gray-800 text-sm">Disease Type</th>
                              <th className="text-right py-2.5 px-3 font-semibold text-gray-800 text-sm">Count</th>
                              <th className="text-right py-2.5 px-3 font-semibold text-gray-800 text-sm">Percentage</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              // Calculate percentage from all disease data (Unknown is excluded from distribution)
                              const chartTotal = diseaseDistribution.reduce((sum, item) => sum + item.value, 0);
                              
                              return diseaseDistribution.map((entry) => {
                                const percentage = chartTotal > 0 
                                  ? ((entry.value / chartTotal) * 100).toFixed(1) 
                                  : "0.0";
                                return (
                                  <tr 
                                    key={entry.name} 
                                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                  >
                                    <td className="py-2 px-3">
                                      <div className="flex items-center gap-2">
                                        <div 
                                          className="w-3 h-3 rounded-full flex-shrink-0 border border-gray-200"
                                          style={{ backgroundColor: DISEASE_COLORS[entry.name] || "#388E3C" }}
                                        />
                                        <span className="font-semibold text-sm text-gray-900">
                                          {entry.name}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="text-right py-2 px-3 font-semibold text-gray-900 text-sm">
                                      {entry.value.toLocaleString("en-US")}
                                    </td>
                                    <td className="text-right py-2 px-3 text-gray-700 font-medium text-sm">
                                      {percentage}%
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                  ) : (
                    <div className="flex h-[200px] w-full items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                      <div className="text-center">
                        <p className="text-sm font-medium text-gray-500">No data to display</p>
                        <p className="text-xs text-gray-400 mt-1">Leaf disease scans will appear here</p>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Fruit Ripeness Distribution Section */}
            <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden" data-chart="ripenessDistribution">
              <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
                <CardTitle className="text-xl font-bold text-white">
                  Fruit Ripeness Distribution
                </CardTitle>
                <p className="text-sm text-white/90 mt-1">Analysis for {dateRangeLabel.toLowerCase()}</p>
              </CardHeader>
              <CardContent className="pt-3 px-6 pb-3">
                {ripenessDistribution.some((item) => item.value > 0) ? (
                  <>
                    <div className="mb-3 flex items-center justify-center">
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart 
                          data={ripenessDistribution.map(item => ({ ...item, fill: RIPENESS_COLORS[item.name] || "#388E3C" }))} 
                          margin={{ top: 20, right: 10, left: 5, bottom: 35 }}
                          barCategoryGap="15%"
                          barSize={35}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                          <XAxis 
                            dataKey="name" 
                            stroke="#6B7280" 
                            fontSize={11} 
                            tick={{ fill: "#374151", fontWeight: 600 }}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                            angle={-15}
                            textAnchor="end"
                            height={30}
                            tickMargin={3}
                          />
                          <YAxis 
                            stroke="#6B7280" 
                            fontSize={11} 
                            tick={{ fill: "#374151", fontWeight: 600 }} 
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, (dataMax: number) => {
                              if (dataMax === 0) return 10;
                              const rounded = Math.ceil(dataMax / 10) * 10;
                              return rounded > 0 ? rounded : 10;
                            }]}
                            tickFormatter={(value) => {
                              // Show exact whole numbers - no abbreviations
                              return value.toString();
                            }}
                            width={50}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#FFFFFF",
                              border: "1px solid #E5E7EB",
                              borderRadius: "8px",
                              fontSize: "12px",
                              padding: "10px 14px",
                              color: "#1F2937",
                              boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                            }}
                            formatter={(value: number, name: string) => [
                              `${value.toLocaleString("en-US")} items`,
                              name
                            ]}
                            cursor={{ fill: "rgba(56, 142, 60, 0.1)" }}
                          />
                          <Bar
                            dataKey="value"
                            name="Count"
                            radius={[4, 4, 0, 0]}
                            label={{ 
                              position: 'top', 
                              fill: '#374151', 
                              fontSize: 11, 
                              fontWeight: 600,
                              formatter: (value: unknown) => {
                                if (typeof value === 'number') {
                                  return value.toLocaleString("en-US");
                                }
                                return String(value ?? '');
                              }
                            }}
                          >
                            {ripenessDistribution.map((entry, index) => (
                              <Cell 
                                key={`ripeness-cell-${index}`}
                                fill={RIPENESS_COLORS[entry.name] || "#388E3C"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    
                    {/* Data Table */}
                    <div className="mt-3 border-t border-gray-200 pt-3">
                      <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Distribution Details</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b-2 border-gray-300 bg-gray-50">
                              <th className="text-left py-2.5 px-3 font-semibold text-gray-800 text-sm">Ripeness Stage</th>
                              <th className="text-right py-2.5 px-3 font-semibold text-gray-800 text-sm">Count</th>
                              <th className="text-right py-2.5 px-3 font-semibold text-gray-800 text-sm">Percentage</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              // Calculate percentage from all ripeness data (Unknown is excluded from distribution)
                              const chartTotal = ripenessDistribution.reduce((sum, item) => sum + item.value, 0);
                              
                              return ripenessDistribution.map((entry) => {
                                const percentage = chartTotal > 0 
                                  ? ((entry.value / chartTotal) * 100).toFixed(1) 
                                  : "0.0";
                                return (
                                  <tr 
                                    key={entry.name} 
                                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                  >
                                    <td className="py-2 px-3">
                                      <div className="flex items-center gap-2">
                                        <div 
                                          className="w-3 h-3 rounded-full flex-shrink-0 border border-gray-200"
                                          style={{ backgroundColor: RIPENESS_COLORS[entry.name] || "#388E3C" }}
                                        />
                                        <span className="font-semibold text-sm text-gray-900">
                                          {entry.name}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="text-right py-2 px-3 font-semibold text-gray-900 text-sm">
                                      {entry.value.toLocaleString("en-US")}
                                    </td>
                                    <td className="text-right py-2 px-3 text-gray-700 font-medium text-sm">
                                      {percentage}%
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex h-[200px] w-full items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-500">No data to display</p>
                      <p className="text-xs text-gray-400 mt-1">Fruit ripeness scans will appear here</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Expert Validation Performance - Chart and AI Accuracy Rate Row */}
          <div className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 items-stretch">
              {/* Expert Validation Performance Chart - 70% width (7 columns) */}
              <div className="lg:col-span-7 flex">
                <Card className="w-full shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden flex flex-col flex-1 h-full" data-chart="expertValidation">
                  <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 flex-shrink-0">
                    <CardTitle className="text-xl font-bold text-white">
                      Expert Validation Performance
                    </CardTitle>
                    <p className="text-sm text-white/90 mt-1">AI Prediction vs Expert Validation Comparison</p>
                  </CardHeader>
                  <CardContent className="pt-4 px-5 pb-4 flex-1 flex flex-col items-center justify-center min-h-0">
                    {expertValidationPerformance.length > 0 ? (() => {
                      // Sort data based on range type
                      let sortedData = [...expertValidationPerformance];
                      if (range === "this_month" || range === "custom") {
                        // For this_month/custom, try to sort by month names if they are month abbreviations
                        const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                        const isMonthFormat = sortedData.some(d => monthOrder.includes(d.month));
                        if (isMonthFormat) {
                          sortedData = sortedData.sort((a, b) => {
                            const aIndex = monthOrder.indexOf(a.month);
                            const bIndex = monthOrder.indexOf(b.month);
                            // If not found in month order, keep original order
                            if (aIndex === -1 && bIndex === -1) return 0;
                            if (aIndex === -1) return 1;
                            if (bIndex === -1) return -1;
                            return aIndex - bIndex;
                          });
                        }
                        // Otherwise, data is already in chronological order from the build function
                      }
                      // For daily and weekly, data is already in chronological order

                      return (
                        <div className="flex-1 w-full flex items-center justify-center">
                          <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                            <BarChart 
                              data={sortedData} 
                              margin={{ top: 15, right: 20, left: 10, bottom: 5 }}
                              barCategoryGap="15%"
                              barSize={32}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                              <XAxis 
                                dataKey="month" 
                                stroke="#6B7280" 
                                fontSize={11} 
                                tick={{ fill: "#374151", fontWeight: 600 }}
                                tickLine={false}
                                axisLine={false}
                                interval={range === "today" ? Math.max(0, Math.floor(expertValidationPerformance.length / 12)) : 0}
                                angle={range === "this_month" && expertValidationPerformance.length > 7 ? -45 : 0}
                                textAnchor={range === "this_month" && expertValidationPerformance.length > 7 ? "end" : "middle"}
                                height={range === "this_month" && expertValidationPerformance.length > 7 ? 60 : 40}
                              />
                              <YAxis 
                                stroke="#6B7280" 
                                fontSize={12} 
                                tick={{ fill: "#374151", fontWeight: 600 }}
                                allowDecimals={false}
                                tickLine={false}
                                axisLine={false}
                                width={50}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "#FFFFFF",
                                  border: "1px solid #E5E7EB",
                                  borderRadius: "8px",
                                  fontSize: "13px",
                                  padding: "10px 14px",
                                  color: "#1F2937",
                                  fontWeight: 500,
                                  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                                }}
                                formatter={(value: number, name: string) => {
                                  if (name === "aiValidated") return [`${value.toLocaleString("en-US")}`, "Expert Validated (Confirmed)"];
                                  if (name === "aiCorrected") return [`${value.toLocaleString("en-US")}`, "Expert Corrected"];
                                  if (name === "totalValidations") return [`${value.toLocaleString("en-US")}`, "Total Validations"];
                                  return [`${value}`, name];
                                }}
                                labelFormatter={(label: string) => {
                                  if (range === "today") return `Hour: ${label}`;
                                  if (range === "this_week") return `Day: ${label}`;
                                  return `Period: ${label}`;
                                }}
                                cursor={{ fill: "rgba(56, 142, 60, 0.1)" }}
                              />
                              <Legend 
                                wrapperStyle={{ fontSize: "12px", paddingTop: "8px", paddingBottom: "0px", color: "#374151", fontWeight: 600 }}
                                iconSize={12}
                              />
                              <Bar dataKey="aiValidated" fill="#22C55E" name="Expert Validated (Confirmed)" radius={[6, 6, 0, 0]} />
                              <Bar dataKey="aiCorrected" fill="#EF4444" name="Expert Corrected" radius={[6, 6, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      );
                    })() : (
                      <div className="flex-1 w-full flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 min-h-[280px]">
                        <p className="text-sm font-medium text-gray-500">No validation performance data available yet.</p>
                        <p className="text-xs text-gray-400 mt-1">Validation data will populate this chart automatically.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* AI Accuracy Rate Chart - 30% width (3 columns) */}
              <div className="lg:col-span-3 flex">
                <Card className="w-full shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden flex flex-col flex-1 h-full" data-chart="aiAccuracyRate">
                  <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 flex-shrink-0">
                    <CardTitle className="text-xl font-bold text-white">
                      AI Accuracy Rate
                    </CardTitle>
                    <p className="text-sm text-white/90 mt-1">Analysis for {dateRangeLabel.toLowerCase()}</p>
                  </CardHeader>
                  <CardContent className="pt-4 px-6 pb-4 flex-1 flex flex-col min-h-0">
                    {(() => {
                      let level = "Needs Improvement";
                      let color = "#EF4444"; // Red for needs improvement
                      if (aiAccuracyRate >= 90) {
                        level = "Excellent";
                        color = "#22C55E"; // Green
                      } else if (aiAccuracyRate >= 75) {
                        level = "Good";
                        color = "#3B82F6"; // Blue
                      } else if (aiAccuracyRate >= 50) {
                        level = "Average";
                        color = "#EAB308"; // Yellow
                      }

                      const pieData = [
                        { name: "Accuracy", value: aiAccuracyRate },
                        { name: "Remaining", value: Math.max(0, 100 - aiAccuracyRate) },
                      ];

                      return (
                        <div className="flex flex-col gap-3 flex-1 justify-between">
                          <div className="w-full flex-shrink-0">
                            <div className="relative mx-auto" style={{ maxWidth: 260 }}>
                              <ResponsiveContainer width="100%" height={200}>
                                <RechartsPieChart>
                                  <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={55}
                                    outerRadius={85}
                                    startAngle={90}
                                    endAngle={-270}
                                    paddingAngle={2}
                                    dataKey="value"
                                    isAnimationActive={true}
                                    animationDuration={800}
                                  >
                                    <Cell key="accuracy" fill={color} stroke="#FFFFFF" strokeWidth={2} />
                                    <Cell key="remaining" fill="#E5E7EB" stroke="#FFFFFF" strokeWidth={2} />
                                  </Pie>
                                  <Tooltip
                                    formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
                                    contentStyle={{
                                      backgroundColor: "#FFFFFF",
                                      border: "1px solid #E5E7EB",
                                      borderRadius: "8px",
                                      fontSize: "12px",
                                      padding: "8px 12px",
                                      boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                                    }}
                                  />
                                </RechartsPieChart>
                              </ResponsiveContainer>
                              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <p className="text-3xl font-bold text-gray-900">{aiAccuracyRate}%</p>
                                <p className="text-xs font-medium text-gray-600 mt-1">{level}</p>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2.5 flex-shrink-0">
                            <div className="flex items-center justify-start gap-2">
                              <span className="inline-block w-3 h-3 rounded-full border border-gray-200" style={{ backgroundColor: "#22C55E" }} />
                              <div className="text-xs">
                                <p className="font-semibold text-gray-900">Excellent</p>
                                <p className="text-gray-600 text-xs">90%–100%</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-start gap-2">
                              <span className="inline-block w-3 h-3 rounded-full border border-gray-200" style={{ backgroundColor: "#3B82F6" }} />
                              <div className="text-xs">
                                <p className="font-semibold text-gray-900">Good</p>
                                <p className="text-gray-600 text-xs">75%–89%</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-start gap-2">
                              <span className="inline-block w-3 h-3 rounded-full border border-gray-200" style={{ backgroundColor: "#EAB308" }} />
                              <div className="text-xs">
                                <p className="font-semibold text-gray-900">Average</p>
                                <p className="text-gray-600 text-xs">50%–74%</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-start gap-2">
                              <span className="inline-block w-3 h-3 rounded-full border border-gray-200" style={{ backgroundColor: "#EF4444" }} />
                              <div className="text-xs">
                                <p className="font-semibold text-gray-900">Needs Improvement</p>
                                <p className="text-gray-600 text-xs">0%–49%</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          {/* App Performance Graph - Full Width */}
          <div className="mt-6" data-chart="appPerformance">
            <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden">
              <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
                <CardTitle className="text-xl font-bold text-white">
                  App Performance Graph
                </CardTitle>
                <p className="text-sm text-white/90 mt-1">Average Performance per Month</p>
              </CardHeader>
              <CardContent className="pt-4 px-6 pb-4">
                {appPerformance.length > 0 ? (() => {
                  // Ensure months are sorted chronologically (Jan → Dec)
                  const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                  const sortedData = [...appPerformance].sort((a, b) => {
                    const aIndex = monthOrder.indexOf(a.month);
                    const bIndex = monthOrder.indexOf(b.month);
                    return aIndex - bIndex;
                  });

                  return (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart 
                        data={sortedData} 
                        margin={{ top: 25, right: 30, left: 20, bottom: 20 }}
                        barCategoryGap="12%"
                        barGap={8}
                        barSize={36}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                        <XAxis 
                          dataKey="month" 
                          stroke="#6B7280" 
                          fontSize={13} 
                          tick={{ fill: "#374151", fontWeight: 600 }}
                          tickLine={false}
                          axisLine={false}
                          interval={0}
                          angle={0}
                          textAnchor="middle"
                          height={50}
                          tickMargin={10}
                        />
                        {/* Y-axis for percentage (0-100%) */}
                        <YAxis 
                          stroke="#6B7280" 
                          fontSize={13} 
                          tick={{ fill: "#374151", fontWeight: 600 }} 
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 100]}
                          tickCount={11}
                          tickFormatter={(value) => `${value}%`}
                          width={60}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#FFFFFF",
                            border: "1px solid #E5E7EB",
                            borderRadius: "8px",
                            fontSize: "13px",
                            padding: "10px 14px",
                            color: "#1F2937",
                            fontWeight: 500,
                            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                          }}
                          cursor={{ fill: "rgba(56, 142, 60, 0.1)" }}
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              const data = sortedData.find(d => d.month === label);
                              return (
                                <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg">
                                  <p className="font-semibold text-gray-900 mb-2 text-sm">{`Month: ${label}`}</p>
                                  <div className="space-y-1">
                                    {payload.map((entry: TooltipPayloadEntry, index: number) => (
                                      <p key={index} className="text-xs text-gray-700">
                                        <span className="font-medium">{entry.name}:</span>{" "}
                                        {entry.name === "Success Rate" || entry.name === "AI Accuracy"
                                          ? `${entry.value.toFixed(1)}%`
                                          : entry.value.toLocaleString("en-US")}
                                      </p>
                                    ))}
                                    {data && (
                                      <>
                                        <p className="text-xs text-gray-700">
                                          <span className="font-medium">Total Scans:</span> {data.totalScans.toLocaleString("en-US")}
                                        </p>
                                        <p className="text-xs text-gray-700">
                                          <span className="font-medium">Validated Scans:</span> {data.validatedScans.toLocaleString("en-US")}
                                        </p>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Legend 
                          wrapperStyle={{ fontSize: "13px", paddingTop: "16px", color: "#374151", fontWeight: 600 }}
                        />
                        {/* Bar for Success Rate - Blue */}
                        <Bar
                          dataKey="successRate"
                          fill="#3B82F6"
                          name="Success Rate"
                          radius={[6, 6, 0, 0]}
                          animationBegin={0}
                          animationDuration={800}
                          label={{ 
                            position: 'top', 
                            fill: '#374151', 
                            fontSize: 11, 
                            fontWeight: 600,
                            formatter: (value: unknown) => {
                              if (typeof value === 'number' && value > 0) {
                                return `${value.toFixed(1)}%`;
                              }
                              return '';
                            }
                          }}
                        />
                        {/* Bar for AI Accuracy - Green */}
                        <Bar
                          dataKey="aiAccuracyRate"
                          fill="#22C55E"
                          name="AI Accuracy"
                          radius={[6, 6, 0, 0]}
                          animationBegin={100}
                          animationDuration={800}
                          label={{ 
                            position: 'top', 
                            fill: '#374151', 
                            fontSize: 11, 
                            fontWeight: 600,
                            formatter: (value: unknown) => {
                              if (typeof value === 'number' && value > 0) {
                                return `${value.toFixed(1)}%`;
                              }
                              return '';
                            }
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })() : (
                  <div className="flex h-[300px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-500">No performance data available yet.</p>
                      <p className="text-xs text-gray-400 mt-1">Performance metrics will populate this chart automatically.</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Monthly Performance Summary - Line Chart + Table */}
          <div className="mt-6" data-chart="monthlyPerformance">
            <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden">
              <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
                <CardTitle className="text-xl font-bold text-white">
                  Monthly Performance Summary
                </CardTitle>
                <p className="text-sm text-white/90 mt-1">Success Rate Trend and Performance Metrics by Month</p>
              </CardHeader>
              <CardContent className="pt-3 px-6 pb-3">
                {appPerformance.length > 0 ? (() => {
                  const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                  const sortedData = [...appPerformance].sort((a, b) => {
                    const aIndex = monthOrder.indexOf(a.month);
                    const bIndex = monthOrder.indexOf(b.month);
                    return aIndex - bIndex;
                  });

                  // Ensure all 12 months are present
                  const allMonthsData: AppPerformanceDatum[] = monthOrder.map(month => {
                    const existing = sortedData.find(d => d.month === month);
                    return existing || {
                      month,
                      successRate: 0,
                      totalScans: 0,
                      validatedScans: 0,
                      avgConfidence: 0,
                      aiAccuracyRate: 0,
                    };
                  });

                  // Find highest and lowest success rates
                  const successRates = allMonthsData.map(d => d.successRate).filter(r => r > 0);
                  const highestRate = successRates.length > 0 ? Math.max(...successRates) : 0;
                  const lowestRate = successRates.length > 0 ? Math.min(...successRates) : 0;

                  // Calculate corrected scans per month
                  // Use validationHistory to get corrected predictions based on when they were validated
                  // Match the exact month calculation used in buildAppPerformance
                  const now = new Date();
                  const getCorrectedScansForMonth = (monthName: string): number => {
                    // Find the matching month data from appPerformance
                    const matchingMonth = sortedData.find(d => d.month === monthName);
                    if (!matchingMonth) return 0;
                    
                    // Recalculate month boundaries using the same logic as buildAppPerformance
                    // Iterate through the last 12 months to find which one matches this monthName
                    let monthStart: Date | null = null;
                    let monthEnd: Date | null = null;
                    
                    for (let i = 11; i >= 0; i--) {
                      const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
                      const calculatedMonthName = monthDate.toLocaleDateString("en-US", { month: "short" });
                      
                      if (calculatedMonthName === monthName) {
                        // Found the matching month - use exact same boundaries as buildAppPerformance
                        monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1, 0, 0, 0, 0));
                        monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
                        break;
                      }
                    }
                    
                    if (!monthStart || !monthEnd) return 0;
                    
                    // Filter validation history for corrected status within the target month
                    // Use validated_at (when expert validated) not created_at (when scan was created)
                    if (!validationHistory || validationHistory.length === 0) return 0;
                    
                    return validationHistory.filter((vh) => {
                      // Only count corrections
                      if (vh.status !== "Corrected") return false;
                      
                      // Check validation date (when expert corrected the prediction)
                      if (!vh?.validated_at) return false;
                      
                      try {
                        // Use UTC timestamp directly from Supabase
                        const validationDate = new Date(vh.validated_at);
                        if (isNaN(validationDate.getTime())) return false;
                        
                        // Check if validation happened within the target month
                        // Use same comparison logic as buildAppPerformance (using date string for date comparison)
                        const validationDateStr = validationDate.toISOString().split("T")[0];
                        const monthStartStr = monthStart.toISOString().split("T")[0];
                        const monthEndStr = monthEnd.toISOString().split("T")[0];
                        return validationDateStr >= monthStartStr && validationDateStr <= monthEndStr;
                      } catch {
                        return false;
                      }
                    }).length;
                  };

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Left Side: Mini Line Chart */}
                      <div className="flex flex-col">
                        <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Success Rate Trend</h3>
                        <div className="flex-1 min-h-[180px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={allMonthsData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                              <XAxis 
                                dataKey="month" 
                                stroke="#6B7280" 
                                fontSize={11} 
                                tick={{ fill: "#374151", fontWeight: 600 }}
                                tickLine={false}
                                axisLine={false}
                              />
                              <YAxis 
                                stroke="#6B7280" 
                                fontSize={11} 
                                tick={{ fill: "#374151", fontWeight: 600 }}
                                tickLine={false}
                                axisLine={false}
                                domain={[0, 100]}
                                width={45}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "#FFFFFF",
                                  border: "1px solid #E5E7EB",
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                  padding: "8px 12px",
                                  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                                }}
                                formatter={(value: number) => [`${value.toFixed(1)}%`, "Success Rate"]}
                                labelFormatter={(label: string) => `Month: ${label}`}
                                cursor={{ stroke: "#3B82F6", strokeWidth: 1, strokeDasharray: "3 3" }}
                              />
                              <Line 
                                type="monotone" 
                                dataKey="successRate" 
                                stroke="#006400" 
                                strokeWidth={2.5}
                                dot={{ fill: "#006400", r: 3.5, strokeWidth: 2, stroke: "#FFFFFF" }}
                                activeDot={{ r: 5 }}
                                isAnimationActive={true}
                                animationDuration={600}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Right Side: Performance Table */}
                      <div className="flex flex-col">
                        <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Monthly Performance Details</h3>
                        <div className="flex-1 w-full">
                          <div className="overflow-x-auto -mx-2">
                            <table className="w-full text-xs min-w-full table-auto">
                              <thead>
                                <tr className="border-b-2 border-gray-300 bg-gray-50">
                                  <th className="text-left py-1.5 px-2 font-semibold text-gray-800 text-xs whitespace-nowrap">Month</th>
                                  <th className="text-right py-1.5 px-1.5 font-semibold text-gray-800 text-xs whitespace-nowrap">Total</th>
                                  <th className="text-right py-1.5 px-1.5 font-semibold text-gray-800 text-xs whitespace-nowrap">
                                    <span className="hidden sm:inline">Validated (Confirmed)</span>
                                    <span className="sm:hidden">Validated</span>
                                  </th>
                                  <th className="text-right py-1.5 px-1.5 font-semibold text-gray-800 text-xs whitespace-nowrap">Corrected</th>
                                  <th className="text-right py-1.5 px-2 font-semibold text-gray-800 text-xs whitespace-nowrap">Success</th>
                                </tr>
                              </thead>
                              <tbody>
                                {allMonthsData.map((entry) => {
                                  const isHighest = entry.successRate > 0 && entry.successRate === highestRate && highestRate !== lowestRate;
                                  const isLowest = entry.successRate > 0 && entry.successRate === lowestRate && highestRate !== lowestRate;
                                  const correctedScans = getCorrectedScansForMonth(entry.month);
                                  
                                  return (
                                    <tr 
                                      key={entry.month} 
                                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                    >
                                      <td className="py-1.5 px-2">
                                        <span className="font-semibold text-xs text-gray-900">
                                          {entry.month}
                                        </span>
                                      </td>
                                      <td className="text-right py-1.5 px-1.5 font-semibold text-gray-900 text-xs">
                                        {entry.totalScans.toLocaleString("en-US")}
                                      </td>
                                      <td className="text-right py-1.5 px-1.5 font-semibold text-gray-900 text-xs">
                                        {entry.validatedScans.toLocaleString("en-US")}
                                      </td>
                                      <td className="text-right py-1.5 px-1.5 font-semibold text-gray-900 text-xs">
                                        {correctedScans.toLocaleString("en-US")}
                                      </td>
                                      <td className={`text-right py-1.5 px-2 font-semibold text-xs ${
                                        isHighest 
                                          ? "text-green-600" 
                                          : isLowest 
                                          ? "text-red-600" 
                                          : "text-gray-900"
                                      }`}>
                                        {entry.successRate.toFixed(1)}%
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="flex h-[300px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                    <p className="text-sm font-medium text-gray-500">No performance data available yet.</p>
                    <p className="text-xs text-gray-400 mt-1">Performance metrics will populate this section automatically.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Monthly Most Scanned - Combined Graph */}
          <div className="mt-6" data-chart="monthlyMostScanned">
            <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden">
              <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
                <CardTitle className="text-xl font-bold text-white">
                  Monthly Most Scanned Categories
                </CardTitle>
                <p className="text-sm text-white/90 mt-1">Most Scanned Leaf Disease & Fruit Ripeness per Month</p>
              </CardHeader>
              <CardContent className="pt-4 px-6 pb-4">
                {monthlyMostScanned.length > 0 ? (() => {
                  const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                  const sortedData = [...monthlyMostScanned].sort((a, b) => {
                    const aIndex = monthOrder.indexOf(a.month);
                    const bIndex = monthOrder.indexOf(b.month);
                    return aIndex - bIndex;
                  });

                  const maxValue = Math.max(
                    ...sortedData.map(item => Math.max(item.leafDiseaseCount, item.fruitRipenessCount)),
                    0
                  );
                  
                  // Calculate Y-axis domain with dynamic incremental scale
                  // Default scale: 0-5 with ticks at 0, 1, 2, 3, 4, 5
                  // If maxValue exceeds 5, scale dynamically to accommodate the highest count
                  let maxDomain = 5;
                  let tickInterval = 1;
                  
                  if (maxValue > 5) {
                    // Round up to the next multiple of 5 for cleaner scaling
                    maxDomain = Math.ceil(maxValue / 5) * 5;
                    // For larger ranges, use interval of 1 for values up to 20, then interval of 5
                    if (maxDomain > 20) {
                      tickInterval = 5;
                    } else {
                      tickInterval = 1;
                    }
                  } else if (maxValue === 0) {
                    maxDomain = 5;
                    tickInterval = 1;
                  }

                  // Calculate tick count based on domain and interval
                  // For 0-5 range: 6 ticks (0,1,2,3,4,5)
                  // For larger ranges: ticks at interval spacing
                  const tickCount = maxDomain <= 5 
                    ? 6 
                    : Math.floor(maxDomain / tickInterval) + 1;

                  return (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart 
                        data={sortedData} 
                        margin={{ top: 60, right: 30, left: 20, bottom: 20 }}
                        barCategoryGap="12%"
                        barGap={8}
                        barSize={32}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                        <XAxis 
                          dataKey="month" 
                          stroke="#6B7280" 
                          fontSize={13} 
                          tick={{ fill: "#374151", fontWeight: 600 }}
                          tickLine={false}
                          axisLine={false}
                          interval={0}
                          angle={0}
                          textAnchor="middle"
                          height={50}
                          tickMargin={10}
                        />
                        <YAxis 
                          stroke="#6B7280" 
                          fontSize={13} 
                          tick={{ fill: "#374151", fontWeight: 600 }} 
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          domain={[0, maxDomain]}
                          ticks={maxDomain <= 5 
                            ? [0, 1, 2, 3, 4, 5]
                            : Array.from({ length: tickCount }, (_, i) => i * tickInterval)
                          }
                          tickFormatter={(value) => {
                            return value.toString();
                          }}
                          width={60}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#FFFFFF",
                            border: "1px solid #E5E7EB",
                            borderRadius: "8px",
                            fontSize: "13px",
                            padding: "10px 14px",
                            color: "#1F2937",
                            fontWeight: 500,
                            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                          }}
                          formatter={((value: any, name: string, props: any) => {
                            const data = props?.payload as MonthlyMostScannedDatum | undefined;
                            const numValue = typeof value === 'number' ? value : (typeof value === 'string' ? parseFloat(value) || 0 : 0);
                            if (name === "leafDiseaseCount") {
                              return [
                                `${numValue.toLocaleString("en-US")} scans`,
                                `Disease: ${data?.mostScannedDisease || 'N/A'}`
                              ];
                            }
                            if (name === "fruitRipenessCount") {
                              return [
                                `${numValue.toLocaleString("en-US")} scans`,
                                `Ripeness: ${data?.mostScannedRipeness || 'N/A'}`
                              ];
                            }
                            return [`${numValue}`, name];
                          }) as any}
                          labelFormatter={(label: string) => {
                            const monthData = sortedData.find(d => d.month === label);
                            if (!monthData) return `Month: ${label}`;
                            return `Month: ${label} - ${monthData.mostScannedDisease || 'N/A'} (Disease) | ${monthData.mostScannedRipeness || 'N/A'} (Ripeness)`;
                          }}
                          cursor={{ fill: "rgba(56, 142, 60, 0.1)" }}
                        />
                        <Legend 
                          wrapperStyle={{ fontSize: "13px", paddingTop: "16px", color: "#374151", fontWeight: 600 }}
                        />
                        <Bar
                          dataKey="leafDiseaseCount"
                          name="Leaf Disease"
                          radius={[6, 6, 0, 0]}
                          animationBegin={0}
                          animationDuration={800}
                          label={(props: any) => {
                            // Access the data entry from props
                            const x = typeof props.x === 'number' ? props.x : 0;
                            const y = typeof props.y === 'number' ? props.y : 0;
                            const width = typeof props.width === 'number' ? props.width : 0;
                            const index = typeof props.index === 'number' ? props.index : 0;
                            const entry = props.payload || sortedData[index];
                            if (!entry || !entry.mostScannedDisease || entry.leafDiseaseCount === 0) return null;
                            const labelText = entry.mostScannedDisease;
                            return (
                              <text
                                x={x + width / 2}
                                y={y - 8}
                                fill="#374151"
                                fontSize={10}
                                fontWeight={600}
                                textAnchor="middle"
                                transform={`rotate(-45 ${x + width / 2} ${y - 8})`}
                              >
                                {labelText}
                              </text>
                            );
                          }}
                        >
                          {sortedData.map((entry, index) => {
                            // Use the color of the most scanned disease for that month
                            const diseaseColor = entry.mostScannedDisease 
                              ? (DISEASE_COLORS[entry.mostScannedDisease] || entry.diseaseColor || "#3B82F6")
                              : "#3B82F6";
                            return (
                              <Cell 
                                key={`leaf-disease-bar-${index}`}
                                fill={diseaseColor}
                              />
                            );
                          })}
                        </Bar>
                        <Bar
                          dataKey="fruitRipenessCount"
                          name="Fruit Ripeness"
                          radius={[6, 6, 0, 0]}
                          animationBegin={0}
                          animationDuration={800}
                          label={(props: any) => {
                            // Access the data entry from props
                            const x = typeof props.x === 'number' ? props.x : 0;
                            const y = typeof props.y === 'number' ? props.y : 0;
                            const width = typeof props.width === 'number' ? props.width : 0;
                            const index = typeof props.index === 'number' ? props.index : 0;
                            const entry = props.payload || sortedData[index];
                            if (!entry || !entry.mostScannedRipeness || entry.fruitRipenessCount === 0) return null;
                            return (
                              <text
                                x={x + width / 2}
                                y={y - 8}
                                fill="#374151"
                                fontSize={10}
                                fontWeight={600}
                                textAnchor="middle"
                                transform={`rotate(-45 ${x + width / 2} ${y - 8})`}
                              >
                                {entry.mostScannedRipeness}
                              </text>
                            );
                          }}
                        >
                          {sortedData.map((entry, index) => {
                            // Use the color of the most scanned ripeness for that month
                            const ripenessColor = entry.mostScannedRipeness 
                              ? (RIPENESS_COLORS[entry.mostScannedRipeness] || entry.ripenessColor || "#F97316")
                              : "#F97316";
                            return (
                              <Cell 
                                key={`fruit-ripeness-bar-${index}`}
                                fill={ripenessColor}
                              />
                            );
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })() : (
                  <div className="flex h-[300px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-500">No monthly scan data available yet.</p>
                      <p className="text-xs text-gray-400 mt-1">Monthly scan data will populate this chart automatically.</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

        </div>
      </AppShell>
    </AuthGuard>
  );
}

