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
import toast from "react-hot-toast";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

import type { Scan, ValidationHistory } from "@/types";
import { getAiPrediction } from "@/types";

// Extended scan type for cases where scan might have additional fields from database joins
type ExtendedScan = Scan & {
  disease_detected?: string;
  ai_prediction?: string;
  ripeness_stage?: string;
  leaf_disease_scans?: { disease_detected?: string };
  leaf_disease_scan?: { disease_detected?: string };
  fruit_ripeness_scans?: { ripeness_stage?: string };
  fruit_ripeness_scan?: { ripeness_stage?: string };
};

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

// Recharts Tooltip item type for formatter
type TooltipItem = {
  payload?: MonthlyMostScannedDatum;
  value?: number;
  name?: string;
  color?: string;
  dataKey?: string;
};

// Recharts Bar label props type - compatible with Recharts Props type
// value can be RenderableText (string | number | null | undefined | ReactNode) per Recharts
type BarLabelProps = {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  index?: number | string;
  payload?: MonthlyMostScannedDatum;
  value?: unknown; // RenderableText from Recharts (string | number | null | undefined | ReactNode)
  [key: string]: unknown; // Allow additional Recharts properties
};
import { 
  parseTimestampToLocal, 
  normalizeToStartOfDay, 
  getLocalHour,
  getStartOfWeek,
  formatLocalDate,
  getLocalDateComponents,
  normalizeToEndOfDay,
  isDateInRange
} from "@/utils/timezone";

// Initialize dayjs plugins
dayjs.extend(utc);
dayjs.extend(timezone);

const MANILA_TZ = 'Asia/Manila';

type Range = "daily" | "weekly" | "monthly" | "custom";

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
  { value: "daily", label: "Today" },
  { value: "weekly", label: "This Week" },
  { value: "monthly", label: "This Month" },
  { value: "custom", label: "Custom" },
];
const RANGE_LABELS: Record<Range, string> = {
  daily: "Today",
  weekly: "This Week",
  monthly: "This Month",
  custom: "Custom Range",
};

const ONE_DAY = 24 * 60 * 60 * 1000;
// Use Asia/Manila timezone for all date formatting
const HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", { 
  hour: "numeric",
  timeZone: "Asia/Manila"
});
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { 
  month: "short", 
  day: "numeric",
  timeZone: "Asia/Manila"
});
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", { 
  weekday: "short",
  timeZone: "Asia/Manila"
});

// Note: parseTimestampToLocal and normalizeToStartOfDay are now imported from @/utils/timezone
// This ensures consistent timezone handling using Asia/Manila timezone

function getRangeStart(range: Range, customStart?: Date) {
  if (range === "custom" && customStart) {
    return normalizeToStartOfDay(customStart);
  }
  const now = normalizeToStartOfDay(new Date());
  if (range === "daily") {
    return now;
  }
  if (range === "weekly") {
    // Use getStartOfWeek which returns Monday in Asia/Manila timezone
    return getStartOfWeek(new Date());
  }
  // Monthly: start of current month in Asia/Manila timezone
  const start = normalizeToStartOfDay(new Date());
  // Set to first day of month
  const localComponents = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(start);
  const year = parseInt(localComponents.find(p => p.type === 'year')?.value || '0', 10);
  const month = parseInt(localComponents.find(p => p.type === 'month')?.value || '0', 10) - 1;
  // Create UTC date representing first day of month at midnight in Asia/Manila
  const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  monthStart.setUTCHours(monthStart.getUTCHours() - 8); // Adjust for UTC+8
  return monthStart;
}

function getRangeEnd(range: Range, customEnd?: Date) {
  if (range === "custom" && customEnd) {
    // For custom range, set to end of day in Asia/Manila timezone
    const end = normalizeToStartOfDay(customEnd);
    // Add 23:59:59.999 in Asia/Manila timezone
    // This means adding 23 hours, 59 minutes, 59 seconds, 999 milliseconds
    // But we need to account for timezone offset
    const endOfDay = new Date(end.getTime() + (23 * 60 * 60 * 1000) + (59 * 60 * 1000) + (59 * 1000) + 999);
    return endOfDay;
  }
  const now = new Date();
  if (range === "daily") {
    // For daily range, set to end of today (23:59:59.999) in Asia/Manila timezone
    const today = normalizeToStartOfDay(now);
    const endOfDay = new Date(today.getTime() + (23 * 60 * 60 * 1000) + (59 * 60 * 1000) + (59 * 1000) + 999);
    return endOfDay;
  }
  // For weekly and monthly, return current time (will be adjusted dynamically in filtering)
  return now;
}

function buildScansTrend(range: Range, scans: Scan[], rangeStart: Date, rangeEnd: Date): TrendDatum[] {
  // Filter out invalid scans first
  const validScans = scans.filter((scan) => {
    // Exclude scans with status = 'Unknown'
    if ((scan.status as string) === 'Unknown') return false;
    // Exclude scans with result = 'Unknown' (disease_detected or ripeness_stage)
    const result = getAiPrediction(scan);
    if (result === 'Unknown') return false;
    // Ensure scan has created_at timestamp
    if (!scan.created_at) return false;
    return true;
  });

  if (range === "daily") {
    // For "daily" range, bucket scans by hour (0-23) in Asia/Manila timezone
    // Note: filteredScans already filters by date range, so we just need to bucket by hour
    const todayManila = dayjs().tz(MANILA_TZ).startOf('day');
    const counts = new Map<number, number>();

    validScans.forEach((scan) => {
      try {
        if (!scan.created_at) return;
        
        // Parse timestamp - handle case where timestamp value is already in Manila time
        // Based on user feedback: timestamp "2025-11-23T11:07:16+00:00" means 11:07:16 Manila time
        // The timestamp value itself represents Manila time, not UTC
        let hour: number;
        
        if (typeof scan.created_at === 'string') {
          const timestampStr = scan.created_at.trim();
          
          // Extract hour directly from timestamp string
          // Format: "2025-11-23T11:07:16.498698+00:00" -> extract "11"
          const timeMatch = timestampStr.match(/T(\d{2}):(\d{2}):(\d{2})/);
          if (timeMatch) {
            // Extract hour directly from timestamp (already in Manila time)
            hour = parseInt(timeMatch[1], 10);
          } else {
            // Fallback: parse with dayjs and convert
            // If timestamp has +00:00, the time value is likely already in Manila time
            // So we need to subtract 8 hours to get UTC, then convert to Manila
            let normalizedStr = timestampStr;
            if (normalizedStr.includes('+00:00') || normalizedStr.endsWith('Z')) {
              // Extract time components
              const match = normalizedStr.match(/T(\d{2}):(\d{2}):(\d{2})/);
              if (match) {
                const [, h, m, s] = match;
                const hourNum = parseInt(h, 10);
                // Subtract 8 hours to get UTC (since value is in Manila time)
                const utcHour = (hourNum - 8 + 24) % 24;
                const datePart = normalizedStr.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
                normalizedStr = `${datePart}T${String(utcHour).padStart(2, '0')}:${m}:${s}Z`;
              }
            }
            const scanManila = dayjs.utc(normalizedStr).tz(MANILA_TZ);
            if (!scanManila.isValid()) {
              console.warn('Invalid timestamp:', scan.created_at);
              return;
            }
            hour = scanManila.hour();
          }
        } else {
          // If it's a Date object, convert to Manila timezone
          const scanManila = dayjs.utc(scan.created_at).tz(MANILA_TZ);
          if (!scanManila.isValid()) {
            console.warn('Invalid timestamp:', scan.created_at);
            return;
          }
          hour = scanManila.hour();
        }
        
        // Validate hour is in valid range
        if (hour < 0 || hour > 23) {
          console.warn('Hour out of range:', hour, 'for timestamp:', scan.created_at);
          return;
        }
        
        // Bucket the scan by hour
        // A scan at 11:00 AM Manila time should be in hour 11 bucket
        counts.set(hour, (counts.get(hour) ?? 0) + 1);
      } catch (error) {
        // Skip invalid dates
        console.warn('Error parsing scan timestamp:', scan.created_at, error);
        return;
      }
    });

    // Generate data points for all 24 hours (00:00 to 23:59) in Asia/Manila timezone
    // Always show all 24 hours to ensure complete chart display
    return Array.from({ length: 24 }, (_, hour) => {
      // Create a dayjs object representing this hour in Manila timezone
      const hourManila = todayManila.add(hour, 'hour');
      
      // Format hour label (e.g., "10 AM", "2 PM", "11 PM")
      // Use 12-hour format with AM/PM for readability
      const period = hourManila.format('h A');
      
      return {
        period,
        scans: counts.get(hour) ?? 0,
      };
    });
  }

  // For weekly, monthly, and custom ranges: bucket by day
  // Convert range boundaries to Manila timezone using dayjs
  // Note: filteredScans already filters by date range, so we just need to bucket by day
  const startManila = dayjs(rangeStart).tz(MANILA_TZ).startOf('day');
  let endManila: dayjs.Dayjs;
  
  if (range === "weekly" || range === "monthly") {
    // Use end of today in Manila timezone (inclusive)
    endManila = dayjs().tz(MANILA_TZ).endOf('day');
  } else {
    // Custom range: use provided end date, inclusive end of day
    endManila = dayjs(rangeEnd).tz(MANILA_TZ).endOf('day');
  }

  // Calculate total days in range (inclusive)
  // Add 1 to include both start and end days
  const totalDays = Math.max(1, endManila.diff(startManila, 'day') + 1);

  const bucketCounts = new Map<number, number>();
  
  validScans.forEach((scan) => {
    if (!scan.created_at) return;
    try {
      // Parse UTC timestamp and convert to Manila timezone using dayjs
      // Supabase timestamptz is always stored as UTC in the database
      // We need to parse it correctly as UTC, ignoring any timezone offsets in the string
      let scanManila: dayjs.Dayjs;
      
      if (typeof scan.created_at === 'string') {
        let timestampStr = scan.created_at.trim();
        
        // Remove any timezone offset (e.g., +08:00, -05:00) and treat as UTC
        // Supabase stores timestamptz as UTC, but might return it with timezone offset
        timestampStr = timestampStr.replace(/[+-]\d{2}:?\d{2}$/, '');
        
        // Replace space with T if needed for ISO format
        if (timestampStr.includes(' ') && !timestampStr.includes('T')) {
          timestampStr = timestampStr.replace(' ', 'T');
        }
        
        // Remove 'Z' if present (we'll add it back to ensure UTC parsing)
        timestampStr = timestampStr.replace(/Z$/, '');
        
        // Ensure we have seconds if missing
        if (timestampStr.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
          timestampStr = timestampStr + ':00';
        }
        
        // Append 'Z' to explicitly mark as UTC
        if (!timestampStr.endsWith('Z')) {
          timestampStr = timestampStr + 'Z';
        }
        
        // Parse as UTC, then convert to Manila timezone
        scanManila = dayjs.utc(timestampStr).tz(MANILA_TZ);
      } else {
        // If it's a Date object, create dayjs in UTC mode, then convert to Manila
        scanManila = dayjs.utc(scan.created_at).tz(MANILA_TZ);
      }
      
      // Validate the parsed date
      if (!scanManila.isValid()) {
        return;
      }
      
      // Get the date (start of day) in Manila timezone for bucketing
      // This ensures scans at any time during the day are included in the correct day bucket
      const scanDateStart = scanManila.startOf('day');
      
      // Check if scan is within range (inclusive boundaries)
      // Use 'day' granularity to include scans at any time during the day
      if (scanDateStart.isBefore(startManila, 'day') || scanDateStart.isAfter(endManila, 'day')) {
        return;
      }
      
      // Calculate day index: difference in days between scan date and start date
      // This gives us the bucket index (0 = start day, 1 = next day, etc.)
      const dayIndex = scanDateStart.diff(startManila, 'day');
      
      // Validate day index is within range
      // dayIndex should be >= 0 and < totalDays
      if (dayIndex < 0 || dayIndex >= totalDays) {
        return;
      }
      
      // Bucket the scan by day index
      bucketCounts.set(dayIndex, (bucketCounts.get(dayIndex) ?? 0) + 1);
    } catch (error) {
      // Skip invalid dates
      console.warn('Error parsing scan timestamp:', scan.created_at, error);
      return;
    }
  });

  if (range === "weekly") {
    const buckets = Math.min(7, totalDays);
    // Generate buckets for each day of the week (Monday to Sunday)
    return Array.from({ length: buckets }, (_, idx) => {
      const dayManila = startManila.add(idx, 'day');
      const period = dayManila.format('ddd'); // Short weekday name (Mon, Tue, etc.)
      
      return {
        period,
        scans: bucketCounts.get(idx) ?? 0,
      };
    });
  }

  // Monthly or Custom: Daily buckets
  // Generate buckets for each day in the range
  return Array.from({ length: totalDays }, (_, idx) => {
    const dayManila = startManila.add(idx, 'day');
    const period = dayManila.format('MMM D'); // e.g., "Nov 22"
    
    return {
      period,
      scans: bucketCounts.get(idx) ?? 0,
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
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    // Format as "Jan" (month only, no year) for cleaner display
    const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });
    
    // Calculate month boundaries (start of month to end of month)
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
    
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
        // Use parseTimestampToLocal for consistent timezone conversion
        const scanDate = parseTimestampToLocal(scan.created_at);
        if (isNaN(scanDate.getTime())) return false;
        const scanTime = scanDate.getTime();
        return scanTime >= monthStart.getTime() && scanTime <= monthEnd.getTime();
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
          // Use parseTimestampToLocal for consistent timezone conversion
          const validationDate = parseTimestampToLocal(vh.validated_at);
          if (isNaN(validationDate.getTime())) return false;
          const validationTime = validationDate.getTime();
          return validationTime >= monthStart.getTime() && validationTime <= monthEnd.getTime();
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
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });
    
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
    
    // Filter scans for this month (exclude Unknown scans)
    const monthScans = scans.filter((scan) => {
      // Exclude scans with status = 'Unknown'
      if ((scan.status as string) === 'Unknown') return false;
      // Exclude scans with result = 'Unknown' (disease_detected or ripeness_stage)
      const result = getAiPrediction(scan);
      if (result === 'Unknown') return false;
      
      if (!scan?.created_at) return false;
      try {
        const scanDate = new Date(scan.created_at);
        if (isNaN(scanDate.getTime())) return false;
        return scanDate >= monthStart && scanDate <= monthEnd;
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

// Build Expert Validation Performance data - Last 12 months (legacy, for backward compatibility)
function buildExpertValidationPerformance(validationHistory: ValidationHistory[]): ExpertValidationDatum[] {
  const now = new Date();
  const months: ExpertValidationDatum[] = [];
  
  // Generate last 12 months
  for (let i = 11; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });
    
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
    
    // Filter validations for this month
    const monthValidations = validationHistory.filter((vh) => {
      if (!vh?.validated_at) return false;
      try {
        const validationDate = new Date(vh.validated_at);
        if (isNaN(validationDate.getTime())) return false;
        return validationDate >= monthStart && validationDate <= monthEnd;
      } catch {
        return false;
      }
    });
    
    const aiValidated = monthValidations.filter((vh) => vh.status === "Validated").length;
    const aiCorrected = monthValidations.filter((vh) => vh.status === "Corrected").length;
    const totalValidations = monthValidations.length;
    const mismatchRate = totalValidations > 0 ? (aiCorrected / totalValidations) * 100 : 0;
    
    months.push({
      month: monthName,
      aiValidated,
      aiCorrected,
      mismatchRate: parseFloat(mismatchRate.toFixed(1)),
      totalValidations,
    });
  }
  
  return months;
}

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
  // Use parseTimestampToLocal for consistent timezone handling
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
      // Use parseTimestampToLocal for consistent timezone conversion
      const validationDate = parseTimestampToLocal(vh.validated_at);
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

  if (range === "daily") {
    // Group by hour
    // For "daily" range, always use today's date dynamically (not the memoized rangeEnd)
    // This ensures real-time updates work correctly - new validations added today are immediately included
    const today = normalizeToStartOfDay(new Date());
    const base = normalizeToStartOfDay(rangeStart);
    const isToday = today.getTime() === base.getTime();
    const now = new Date();
    const currentHour = isToday ? Math.min(now.getHours() + 1, 24) : 24;
    
    for (let hour = 0; hour < currentHour; hour++) {
      const hourStart = new Date(base);
      hourStart.setHours(hour, 0, 0, 0);
      const hourEnd = new Date(base);
      hourEnd.setHours(hour, 59, 59, 999);
      
      const hourValidations = filteredValidations.filter((vh) => {
        try {
          const validationDate = parseTimestampToLocal(vh.validated_at);
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
      stamp.setHours(hour);
      const periodLabel = HOUR_FORMATTER.format(stamp);
      
      data.push({
        month: periodLabel,
        aiValidated,
        aiCorrected,
        mismatchRate: parseFloat(mismatchRate.toFixed(1)),
        totalValidations,
      });
    }
  } else if (range === "weekly") {
    // Group by day
    const startDay = normalizeToStartOfDay(rangeStart);
    const endDay = normalizeToStartOfDay(rangeEnd);
    const totalDays = Math.ceil((endDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const buckets = Math.min(7, totalDays);
    
    for (let idx = 0; idx < buckets; idx++) {
      const stamp = new Date(startDay);
      stamp.setDate(startDay.getDate() + idx);
      const dayStart = new Date(stamp);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(stamp);
      dayEnd.setHours(23, 59, 59, 999);
      
      const dayValidations = filteredValidations.filter((vh) => {
        try {
          const validationDate = parseTimestampToLocal(vh.validated_at);
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
      const startDay = normalizeToStartOfDay(rangeStart);
      const endDay = normalizeToStartOfDay(rangeEnd);
      const buckets = totalDays;
      
      for (let idx = 0; idx < buckets; idx++) {
        const stamp = new Date(startDay);
        stamp.setDate(startDay.getDate() + idx);
        const dayStart = new Date(stamp);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(stamp);
        dayEnd.setHours(23, 59, 59, 999);
        
        const dayValidations = filteredValidations.filter((vh) => {
          try {
            // Use parseTimestampToLocal for consistent timezone conversion
            const validationDate = parseTimestampToLocal(vh.validated_at);
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
      const startMonth = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      const endMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
      
      const currentMonth = new Date(startMonth);
      while (currentMonth <= endMonth) {
        const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1, 0, 0, 0, 0);
        const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59, 999);
        
        // Adjust for actual range boundaries
        const actualStart = monthStart < rangeStart ? rangeStart : monthStart;
        const actualEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;
        
        const monthValidations = filteredValidations.filter((vh) => {
          try {
            const validationDate = parseTimestampToLocal(vh.validated_at);
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
        currentMonth.setMonth(currentMonth.getMonth() + 1);
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
  const [range, setRange] = useState<Range>("daily");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [showCustomPicker, setShowCustomPicker] = useState(false);

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
      // Fallback to daily if date parsing fails
      return normalizeToStartOfDay(new Date());
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

  // Filter scans to exclude only Unknown scans (no date filtering)
  // This is used for Total Scans and Total Validated cards to show ALL scans
  // Real-time updates will immediately reflect new scans regardless of date
  const allValidScans = useMemo(() => {
    if (!scans || scans.length === 0) return [];
    
    return scans.filter((scan) => {
      // Ensure scan has required fields
      if (!scan || !scan.id) return false;
      
      // Exclude scans with status = 'Unknown'
      if ((scan.status as string) === 'Unknown') return false;
      
      // Exclude scans with result = 'Unknown' (disease_detected or ripeness_stage)
      // But allow scans with empty/null results (they might be pending)
      try {
        const result = getAiPrediction(scan);
        // Only exclude if result is explicitly 'Unknown', allow empty/null/undefined
        if (result && String(result).trim().toLowerCase() === 'unknown') return false;
      } catch {
        // If getAiPrediction fails, still include the scan (might be a data issue)
      }
      
      return true; // Include all valid scans regardless of date
    });
  }, [scans]);

  // Filter scans by date range for charts (excludes Unknown + date filtering)
  // For "daily" range, compares date portions to ensure all scans from today are included
  // This ensures real-time updates work correctly - new scans added today are immediately included
  const filteredScans = useMemo(() => {
    if (!allValidScans || allValidScans.length === 0) return [];
    
    return allValidScans.filter((scan) => {
      // Ensure scan has created_at timestamp for date filtering
      if (!scan.created_at) return false;
      
      try {
        // Use parseTimestampToLocal for consistent timezone conversion
        // This ensures timezone conversion is handled correctly
        const createdAt = parseTimestampToLocal(scan.created_at);
        
        // Ensure valid date
        if (isNaN(createdAt.getTime())) return false;
        
        // For "daily" range, compare date portions (day/month/year) in Asia/Manila timezone
        // This ensures all scans created today are included, even if rangeEnd was calculated earlier
        if (range === "daily") {
          const scanManila = getLocalDateComponents(createdAt);
          const nowManila = getLocalDateComponents(new Date());
          
          // Compare date portions in Manila timezone - if scan date matches today, include it
          // This ensures real-time updates work correctly for "today" analysis
          return (
            scanManila.year === nowManila.year &&
            scanManila.month === nowManila.month &&
            scanManila.day === nowManila.day
          );
        }
        
        // For other ranges (weekly, monthly, custom), use inclusive timestamp comparison
        // Convert range boundaries to proper inclusive start/end in Manila timezone
        const scanTime = createdAt.getTime();
        const rangeStartTime = normalizeToStartOfDay(rangeStart).getTime();
        let rangeEndTime: number;
        
        // For weekly and monthly ranges, use inclusive end of today
        // For custom range, use inclusive end of the selected end date
        if (range === "weekly" || range === "monthly") {
          rangeEndTime = normalizeToEndOfDay(new Date()).getTime();
        } else {
          rangeEndTime = normalizeToEndOfDay(rangeEnd).getTime();
        }
        
        // Use inclusive range: scanTime >= rangeStartTime && scanTime <= rangeEndTime
        // This ensures scans at boundary times are included correctly
        return scanTime >= rangeStartTime && scanTime <= rangeEndTime;
      } catch {
        // If date parsing fails, exclude the scan (invalid timestamp)
        return false;
      }
    });
  }, [allValidScans, rangeStart, rangeEnd, range]);

  // Calculate total scans count - Filtered by selected date range
  // Counts valid scans from both tables within the selected date range, excluding only "Unknown" results
  // Includes all validation statuses (Pending Validation, Validated, Corrected)
  // This updates automatically when scans are added/updated via real-time subscriptions
  // Real-time updates will immediately reflect new scans within the selected date range
  const totalScansCount = useMemo(() => {
    // Use filteredScans to show only scans within the selected date range
    // This ensures the count matches the selected filter (Today, This Week, This Month, Custom)
    if (!filteredScans || filteredScans.length === 0) return 0;
    
    // Count all valid scans from both leaf_disease_scans and fruit_ripeness_scans within the date range
    // This will automatically update when scans state changes or date range filter changes
    return filteredScans.length;
  }, [filteredScans]);


  const aiAccuracyRate = useMemo(() => {
    // AI Accuracy Rate = (Validated count) / (Validated + Corrected count) * 100
    // Note: Both "Confirm" and "Correct" actions set scan.status to "Validated"
    // The validation_history table tracks whether it was "Validated" or "Corrected" for AI accuracy
    // This updates automatically when validations are added/updated via real-time subscriptions
    
    if (!validationHistory || validationHistory.length === 0) {
      return 0;
    }
    
    // Filter validation history by date range and exclude Unknown scans
    // Use parseTimestampToLocal for consistent timezone handling
    const filteredValidations = validationHistory.filter((vh) => {
      if (!vh?.validated_at) return false;
      
      // Exclude validations for Unknown scans
      if (vh.scan) {
        if ((vh.scan.status as string) === 'Unknown') return false;
        const result = getAiPrediction(vh.scan);
        if (result === 'Unknown') return false;
      }
      
      try {
        // Use parseTimestampToLocal for consistent timezone conversion
        const validationDate = parseTimestampToLocal(vh.validated_at);
        if (isNaN(validationDate.getTime())) return false;
        
        // Compare timestamps for accurate date range filtering
        const validationTime = validationDate.getTime();
        const rangeStartTime = rangeStart.getTime();
        let rangeEndTime = rangeEnd.getTime();
        
        // For weekly and monthly ranges, ensure rangeEnd is current time to include new validations
        // This fixes the issue where memoized rangeEnd might be stale
        if (range === "weekly" || range === "monthly") {
          rangeEndTime = new Date().getTime();
        }
        
        // Check if validation is within the selected date range
        return validationTime >= rangeStartTime && validationTime <= rangeEndTime;
      } catch {
        return false;
      }
    });
    
    // Count validated (AI was correct, expert confirmed) and corrected (AI was wrong, expert corrected)
    const validatedCount = filteredValidations.filter((vh) => vh.status === "Validated").length;
    const correctedCount = filteredValidations.filter((vh) => vh.status === "Corrected").length;
    const total = validatedCount + correctedCount;
    
    if (total === 0) {
      // If no validated scans in range, return 0
      return 0;
    }
    
    const rate = (validatedCount / total) * 100;
    return parseFloat(rate.toFixed(1));
  }, [validationHistory, rangeStart, rangeEnd, range]);


  // Calculate validated scans: Filtered by selected date range
  // This updates automatically when scans are validated via real-time subscriptions
  // A scan is considered validated if its status is NOT "Pending Validation"
  // Uses filteredScans to show only validated scans within the selected date range
  const validatedScansCount = useMemo(() => {
    if (!filteredScans || filteredScans.length === 0) return 0;
    
    // Count scans that are NOT "Pending Validation" within the selected date range
    // This includes scans with status "Validated", "Corrected", or any other non-pending status
    // Uses filteredScans to show only validated scans within the selected date range
    // This ensures the count matches the selected filter (Today, This Week, This Month, Custom)
    const validated = filteredScans.filter((s) => s.status !== "Pending Validation").length;
    return validated;
  }, [filteredScans]);

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
    return buildAppPerformance(scans, validationHistory);
  }, [scans, validationHistory]);

  // Monthly Most Scanned - Last 12 months
  const monthlyMostScanned = useMemo(() => {
    return buildMonthlyMostScanned(scans);
  }, [scans]);

  // Expert Validation Performance - Filtered by selected range
  const expertValidationPerformance = useMemo(() => {
    if (!validationHistory || validationHistory.length === 0) return [];
    return buildExpertValidationPerformanceFiltered(range, validationHistory, rangeStart, rangeEnd);
  }, [validationHistory, range, rangeStart, rangeEnd]);

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
  // filteredScans uses allValidScans which updates automatically when new scans are added
  // For "today" filter, filteredScans correctly compares date portions to include all scans from today
  // This ensures new scans added today are immediately reflected in the chart
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
    
    // Filter for leaf disease scans only from leaf_disease_scans table
    // Only count scans with scan_type === "leaf_disease" (data from leaf_disease_scans table)
    // This ensures we're only counting scans from the leaf_disease_scans database table
    const leafDiseaseScans = filteredScans.filter((scan) => {
      // Ensure scan exists and has required properties
      if (!scan || !scan.id) return false;
      
      // Explicitly check for leaf_disease type - ensures we only count from leaf_disease_scans
      if (!scan.scan_type) return false;
      
      return scan.scan_type === "leaf_disease";
    });
    
    // Debug: Log leaf disease scans count in development
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Disease Distribution] Leaf disease scans found:', leafDiseaseScans.length, {
        totalFilteredScans: filteredScans.length,
        range: range
      });
    }
    
    // Helper function to normalize disease name for consistent matching
    // More flexible matching to handle variations in disease names
    const normalizeDiseaseName = (diseaseName: string): string | null => {
      if (!diseaseName) return null;
      
      const normalized = String(diseaseName).trim().toLowerCase().replace(/\s+/g, ' ');
      
      // Skip Unknown results (case-insensitive)
      if (normalized === 'unknown' || normalized === '' || normalized === 'n/a' || normalized === 'null') {
        return null;
      }
      
      // Map to standard disease names (case-insensitive matching with flexible patterns)
      // Check most specific matches first, then broader matches
      
      // Cercospora - exact match or contains
      if (normalized === "cercospora" || normalized.includes("cercospora")) {
        return "Cercospora";
      }
      
      // Yellow Mosaic Virus - check for "yellow mosaic virus", "yellow mosaic", or both words
      if (normalized === "yellow mosaic virus" || 
          normalized === "yellow mosaic" ||
          (normalized.includes("yellow") && normalized.includes("mosaic")) ||
          (normalized.includes("yellow") && normalized.includes("virus") && normalized.includes("mosaic"))) {
        return "Yellow Mosaic Virus";
      }
      
      // Healthy - exact match or contains
      if (normalized === "healthy" || normalized.includes("healthy")) {
        return "Healthy";
      }
      
      // Fusarium Wilt - check for "fusarium wilt" or just "fusarium" (likely means wilt)
      if (normalized === "fusarium wilt" || 
          normalized === "fusarium" ||
          (normalized.includes("fusarium") && normalized.includes("wilt")) ||
          (normalized.includes("fusarium") && !normalized.includes("dry"))) {
        return "Fusarium Wilt";
      }
      
      // Downy Mildew - check for "downy mildew" or just "downy" or "mildew" (but not powdery)
      if (normalized === "downy mildew" || 
          normalized === "downy" ||
          (normalized.includes("downy") && normalized.includes("mildew")) ||
          (normalized.includes("downy") && !normalized.includes("powdery")) ||
          (normalized.includes("mildew") && !normalized.includes("powdery") && !normalized.includes("powdery"))) {
        return "Downy Mildew";
      }
      
      // If no match found, log in development for debugging
      if (process.env.NODE_ENV === 'development') {
        console.debug('[Disease Distribution] Unmatched disease name:', diseaseName, 'normalized:', normalized);
      }
      
      // Return null if no match (will be excluded from chart)
      return null;
    };
    
    // Aggregate counts for each disease type from leaf_disease_scans
    // This processes all leaf disease scans and groups them by disease type
    // Real-time updates: When new scans are added, filteredScans updates, triggering recalculation
    let processedCount = 0;
    let skippedCount = 0;
    
    leafDiseaseScans.forEach((scan) => {
      try {
        // Get disease_detected from leaf_disease_scans table
        // Try multiple methods to ensure we get the disease value:
        // 1. Use getAiPrediction helper (handles both disease_detected and ai_prediction fallback)
        // 2. Direct access to disease_detected field as fallback
        // 3. Check nested structures if needed
        let diseaseDetected: string | null | undefined = null;
        
        // First try getAiPrediction helper
        diseaseDetected = getAiPrediction(scan);
        
        // If getAiPrediction returns empty, try direct access to disease_detected field
        // This handles cases where the scan object might have the field directly
        if (!diseaseDetected || diseaseDetected.trim() === '') {
          const scanExtended = scan as ExtendedScan;
          // Try multiple possible field paths
          diseaseDetected = scanExtended.disease_detected 
            || scanExtended.ai_prediction 
            || scanExtended.leaf_disease_scans?.disease_detected
            || scanExtended.leaf_disease_scan?.disease_detected
            || null;
        }
        
        // Handle null/undefined/empty values - skip only if truly empty
        if (!diseaseDetected || (typeof diseaseDetected === 'string' && diseaseDetected.trim() === '')) {
          skippedCount++;
          if (process.env.NODE_ENV === 'development') {
            const scanExtended = scan as ExtendedScan;
            console.debug('[Disease Distribution] Skipping scan with empty disease_detected:', {
              scanId: scan?.id,
              scanType: scan?.scan_type,
              hasDiseaseDetected: !!scanExtended?.disease_detected,
              hasAiPrediction: !!scanExtended?.ai_prediction,
              scanKeys: scan ? Object.keys(scan) : []
            });
          }
          return;
        }
        
        const diseaseStr = String(diseaseDetected).trim();
        
        // Skip if empty after trimming
        if (!diseaseStr) {
          skippedCount++;
          return;
        }
        
        // Normalize and match disease name
        const normalizedDisease = normalizeDiseaseName(diseaseStr);
        
        // Skip if disease name couldn't be normalized or is Unknown
        if (!normalizedDisease) {
          skippedCount++;
          if (process.env.NODE_ENV === 'development') {
            console.debug('[Disease Distribution] Skipping scan with unmatched disease name:', {
              scanId: scan?.id,
              originalDisease: diseaseStr,
              normalized: diseaseStr.toLowerCase()
            });
          }
          return;
        }
        
        // Increment count for matched disease type
        // This ensures each disease type is counted correctly for the distribution chart
        counts.set(normalizedDisease, (counts.get(normalizedDisease) || 0) + 1);
        processedCount++;
      } catch (error) {
        // Skip on error - don't count invalid scans
        skippedCount++;
        if (process.env.NODE_ENV === 'development') {
          const scanExtended = scan as ExtendedScan;
          console.debug('[Disease Distribution] Error processing scan:', error, {
            scanId: scan?.id,
            scanType: scan?.scan_type,
            hasDiseaseDetected: !!scanExtended?.disease_detected,
            hasAiPrediction: !!scanExtended?.ai_prediction,
            errorMessage: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });
    
    // Debug: Log aggregation results in development
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Disease Distribution] Aggregation summary:', {
        totalLeafScans: leafDiseaseScans.length,
        processed: processedCount,
        skipped: skippedCount,
        counts: Object.fromEntries(counts)
      });
    }
    
    // Return in specific order with all items (even if 0), excluding Unknown
    // This ensures the chart always shows all disease types even if they have 0 counts
    // Real-time update flow:
    // 1. New scan added → DataContext updates scans state via Supabase Realtime
    // 2. allValidScans recalculates (excludes only Unknown)
    // 3. filteredScans recalculates (applies date filter, uses date portion comparison for "daily")
    // 4. diseaseDistribution recalculates → Chart re-renders with new data
    const result = diseaseTypes.map((name) => ({
      name,
      value: counts.get(name) || 0,
    }));
    
    // Debug: Log final distribution in development
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Disease Distribution] Final distribution:', result, {
        totalScans: leafDiseaseScans.length,
        range: range,
        timestamp: new Date().toISOString()
      });
    }
    
    return result;
  }, [filteredScans, range]);

  // Fruit Ripeness Distribution - Updates in real-time via filteredScans dependency
  // filteredScans uses allValidScans which updates automatically when new scans are added
  // For "today" filter, filteredScans correctly compares date portions to include all scans from today
  // This ensures new scans added today are immediately reflected in the chart
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
    
    // Filter for fruit ripeness scans only from fruit_ripeness_scans table
    // Only count scans with scan_type === "fruit_maturity" (data from fruit_ripeness_scans table)
    filteredScans
      .filter((scan) => {
        // Ensure scan exists and has required properties
        if (!scan || !scan.id) return false;
        
        // Explicitly check for fruit_maturity type - ensures we only count from fruit_ripeness_scans
        if (!scan.scan_type) return false;
        
        return scan.scan_type === "fruit_maturity";
      })
      .forEach((scan) => {
        try {
          // Get ripeness_stage directly from fruit_ripeness_scans table
          // Use getAiPrediction helper which returns ripeness_stage for fruit scans
          let prediction = getAiPrediction(scan);
          
          // If getAiPrediction returns empty, try direct access
          if (!prediction || prediction.trim() === '') {
            const scanExtended = scan as ExtendedScan;
            // Try multiple possible field paths
            prediction = scanExtended.ripeness_stage 
              || scanExtended.ai_prediction 
              || scanExtended.fruit_ripeness_scans?.ripeness_stage
              || scanExtended.fruit_ripeness_scan?.ripeness_stage
              || '';
          }
          
          const predictionStr = String(prediction).trim();
          
          // Skip empty predictions and Unknown results
          if (!predictionStr || predictionStr === 'Unknown' || predictionStr.toLowerCase() === 'unknown') {
            if (process.env.NODE_ENV === 'development') {
              const scanExtended = scan as ExtendedScan;
              console.debug('[Ripeness Distribution] Skipping scan with empty/unknown ripeness_stage:', {
                scanId: scan?.id,
                scanType: scan?.scan_type,
                hasRipenessStage: !!scanExtended?.ripeness_stage,
                hasAiPrediction: !!scanExtended?.ai_prediction
              });
            }
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
          } else {
            // Log unmatched ripeness stages in development
            if (process.env.NODE_ENV === 'development') {
              console.debug('[Ripeness Distribution] Unmatched ripeness stage:', {
                scanId: scan?.id,
                originalRipeness: predictionStr,
                normalized: normalized
              });
            }
          }
          // Unknown cases are now skipped
        } catch (error) {
          // Skip on error - don't count invalid scans
          if (process.env.NODE_ENV === 'development') {
            console.debug('[Ripeness Distribution] Error processing scan:', error, {
              scanId: scan?.id,
              scanType: scan?.scan_type,
              errorMessage: error instanceof Error ? error.message : String(error)
            });
          }
        }
      });

    // Return in specific order with all items (even if 0), excluding Unknown
    // This ensures the chart always shows all ripeness types even if they have 0 counts
    // Real-time update flow:
    // 1. New scan added → DataContext updates scans state via Supabase Realtime
    // 2. allValidScans recalculates (excludes only Unknown)
    // 3. filteredScans recalculates (applies date filter, uses date portion comparison for "daily")
    // 4. ripenessDistribution recalculates → Chart re-renders with new data
    return ripenessTypes.map((name) => ({
      name,
      value: counts.get(name) || 0,
    }));
  }, [filteredScans, range]);

  // Generate insights - after all data is calculated
  const insights = useMemo(() => {
    return generateInsights(scans, validationHistory || [], appPerformance, diseaseDistribution, ripenessDistribution, monthlyMostScanned);
  }, [scans, validationHistory, appPerformance, diseaseDistribution, ripenessDistribution, monthlyMostScanned]);

  // Build monthly scans summary (Jan-Dec) for report export
  const monthlyScansSummary = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const months: Array<{
      month: string;
      totalScans: number;
      validatedScans: number;
      successRate: number;
      aiAccuracy: number;
    }> = [];

    // Generate all 12 months of current year
    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(currentYear, i, 1);
      const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });
      const monthStart = new Date(currentYear, i, 1, 0, 0, 0, 0);
      const monthEnd = new Date(currentYear, i + 1, 0, 23, 59, 59, 999);

      // Filter scans for this month
      const monthScans = scans.filter((scan) => {
        if ((scan.status as string) === 'Unknown') return false;
        const result = getAiPrediction(scan);
        if (result === 'Unknown') return false;
        if (!scan?.created_at) return false;
        try {
          const scanDate = parseTimestampToLocal(scan.created_at);
          if (isNaN(scanDate.getTime())) return false;
          const scanTime = scanDate.getTime();
          return scanTime >= monthStart.getTime() && scanTime <= monthEnd.getTime();
        } catch {
          return false;
        }
      });

      const totalScans = monthScans.length;
      const validatedScans = monthScans.filter((s) => s.status !== "Pending Validation").length;
      const successRate = totalScans > 0 ? (validatedScans / totalScans) * 100 : 0;

      // Calculate AI Accuracy for this month
      const monthValidations = (validationHistory || []).filter((vh) => {
        if (!vh?.validated_at) return false;
        try {
          const validationDate = parseTimestampToLocal(vh.validated_at);
          if (isNaN(validationDate.getTime())) return false;
          const validationTime = validationDate.getTime();
          return validationTime >= monthStart.getTime() && validationTime <= monthEnd.getTime();
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
  }, [scans, validationHistory]);

  // Calculate Success Rate for KPI
  const successRate = useMemo(() => {
    if (totalScansCount === 0) return 0;
    return parseFloat(((validatedScansCount / totalScansCount) * 100).toFixed(1));
  }, [totalScansCount, validatedScansCount]);

  // Expert Validation Performance Summary
  const expertValidationSummary = useMemo(() => {
    const filteredValidations = (validationHistory || []).filter((vh) => {
      if (!vh?.validated_at) return false;
      if (vh.scan) {
        if ((vh.scan.status as string) === 'Unknown') return false;
        const result = getAiPrediction(vh.scan);
        if (result === 'Unknown') return false;
      }
      try {
        const validationDate = parseTimestampToLocal(vh.validated_at);
        if (isNaN(validationDate.getTime())) return false;
        const validationTime = validationDate.getTime();
        const rangeStartTime = rangeStart.getTime();
        let rangeEndTime = rangeEnd.getTime();
        if (range === "weekly" || range === "monthly") {
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
  }, [validationHistory, rangeStart, rangeEnd, range]);

  // Generate CSV Export
  const generateCSV = useCallback(() => {
    const rows: string[] = [];

    // Report Header
    rows.push('Ampalaya Scan Performance Report');
    rows.push('');
    rows.push(`Date Range,${dateRangeLabel}`);
    rows.push(`Generated By,Expert Dashboard`);
    rows.push(`Generated On,${dayjs().tz(MANILA_TZ).format('YYYY-MM-DD HH:mm:ss')}`);
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
    link.download = `ampalaya-scan-report-${dayjs().tz(MANILA_TZ).format('YYYY-MM-DD')}.csv`;
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

    const currentDate = dayjs().tz(MANILA_TZ).format('YYYY-MM-DD HH:mm:ss');
    const reportDate = dateRangeLabel;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Ampalaya Scan Performance Report</title>
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
    <h1>Ampalaya Scan Performance Report</h1>
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

  if (loading) {
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
                value: `${aiAccuracyRate}%`,
                color: "text-green-600",
              },
              {
                icon: Camera,
                label: "Total Scans",
                value: totalScansCount.toLocaleString("en-US"),
                color: "text-green-600",
              },
              {
                icon: CheckCircle2,
                label: "Total Validated",
                value: validatedScansCount.toLocaleString("en-US"),
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
                        angle={range === "daily" ? 0 : -45}
                        textAnchor={range === "daily" ? "middle" : "end"}
                        height={range === "daily" ? 30 : 60}
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
                        formatter={(value: number | string | readonly (string | number)[] | undefined, name: string) => {
                          let displayValue: number;
                          
                          // Check if value is an array
                          if (Array.isArray(value)) {
                            displayValue = value.length > 0 
                              ? (typeof value[0] === 'number' ? value[0] : Number(value[0]) || 0)
                              : 0;
                          } else {
                            // value is number, string, or undefined
                            displayValue = typeof value === 'number' ? value : (Number(value) || 0);
                          }
                          
                          return [
                            `${displayValue.toLocaleString("en-US")} scans`,
                            name
                          ];
                        }}
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
                                formatter={(value: number | string | readonly (string | number)[] | undefined, name: string) => {
                                  let displayValue: number;
                                  
                                  // Check if value is an array
                                  if (Array.isArray(value)) {
                                    displayValue = value.length > 0 
                                      ? (typeof value[0] === 'number' ? value[0] : Number(value[0]) || 0)
                                      : 0;
                                  } else {
                                    // value is number, string, or undefined
                                    displayValue = typeof value === 'number' ? value : (Number(value) || 0);
                                  }
                                  
                                  return [
                                    `${displayValue.toLocaleString("en-US")} cases`,
                                    name
                                  ];
                                }}
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
                            formatter={(value: number | string | readonly (string | number)[] | undefined, name: string) => {
                              let displayValue: number;
                              
                              // Check if value is an array
                              if (Array.isArray(value)) {
                                displayValue = value.length > 0 
                                  ? (typeof value[0] === 'number' ? value[0] : Number(value[0]) || 0)
                                  : 0;
                              } else {
                                // value is number, string, or undefined
                                displayValue = typeof value === 'number' ? value : (Number(value) || 0);
                              }
                              
                              return [
                                `${displayValue.toLocaleString("en-US")} items`,
                                name
                              ];
                            }}
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
                      if (range === "monthly" || range === "custom") {
                        // For monthly/custom, try to sort by month names if they are month abbreviations
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
                                interval={range === "daily" ? Math.max(0, Math.floor(expertValidationPerformance.length / 12)) : 0}
                                angle={range === "monthly" && expertValidationPerformance.length > 7 ? -45 : 0}
                                textAnchor={range === "monthly" && expertValidationPerformance.length > 7 ? "end" : "middle"}
                                height={range === "monthly" && expertValidationPerformance.length > 7 ? 60 : 40}
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
                                formatter={(value: number | string | readonly (string | number)[] | undefined, name: string) => {
                                  let displayValue: number;
                                  
                                  // Check if value is an array
                                  if (Array.isArray(value)) {
                                    displayValue = value.length > 0 
                                      ? (typeof value[0] === 'number' ? value[0] : Number(value[0]) || 0)
                                      : 0;
                                  } else {
                                    // value is number, string, or undefined
                                    displayValue = typeof value === 'number' ? value : (Number(value) || 0);
                                  }
                                  
                                  if (name === "aiValidated") return [`${displayValue.toLocaleString("en-US")}`, "Expert Validated (Confirmed)"];
                                  if (name === "aiCorrected") return [`${displayValue.toLocaleString("en-US")}`, "Expert Corrected"];
                                  if (name === "totalValidations") return [`${displayValue.toLocaleString("en-US")}`, "Total Validations"];
                                  return [`${displayValue}`, name];
                                }}
                                labelFormatter={(label: string) => {
                                  if (range === "daily") return `Hour: ${label}`;
                                  if (range === "weekly") return `Day: ${label}`;
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
                                    formatter={(value: number | string | readonly (string | number)[] | undefined, name: string) => {
                                      let displayValue: number;
                                      
                                      // Check if value is an array
                                      if (Array.isArray(value)) {
                                        displayValue = value.length > 0 
                                          ? (typeof value[0] === 'number' ? value[0] : Number(value[0]) || 0)
                                          : 0;
                                      } else {
                                        // value is number, string, or undefined
                                        displayValue = typeof value === 'number' ? value : (Number(value) || 0);
                                      }
                                      
                                      return [`${displayValue.toFixed(1)}%`, name];
                                    }}
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
                      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
                      const calculatedMonthName = monthDate.toLocaleDateString("en-US", { month: "short" });
                      
                      if (calculatedMonthName === monthName) {
                        // Found the matching month - use exact same boundaries as buildAppPerformance
                        monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0, 0);
                        monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
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
                        const validationDate = new Date(vh.validated_at);
                        if (isNaN(validationDate.getTime())) return false;
                        
                        // Check if validation happened within the target month
                        // Use same comparison logic as buildAppPerformance (>= and <=)
                        return validationDate >= monthStart && validationDate <= monthEnd;
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
                                formatter={(value: number | string | readonly (string | number)[] | undefined) => {
                                  let displayValue: number;
                                  
                                  // Check if value is an array
                                  if (Array.isArray(value)) {
                                    displayValue = value.length > 0 
                                      ? (typeof value[0] === 'number' ? value[0] : Number(value[0]) || 0)
                                      : 0;
                                  } else {
                                    // value is number, string, or undefined
                                    displayValue = typeof value === 'number' ? value : (Number(value) || 0);
                                  }
                                  
                                  return [`${displayValue.toFixed(1)}%`, "Success Rate"];
                                }}
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
                          formatter={(
                            value: number | string | readonly (string | number)[] | undefined,
                            name: string,
                            props?: { payload?: MonthlyMostScannedDatum }
                          ) => {
                            let displayValue: number;
                            
                            // Check if value is an array
                            if (Array.isArray(value)) {
                              displayValue = value.length > 0 
                                ? (typeof value[0] === 'number' ? value[0] : Number(value[0]) || 0)
                                : 0;
                            } else {
                              // value is number, string, or undefined
                              displayValue = typeof value === 'number' ? value : (Number(value) || 0);
                            }
                            
                            // Return formatted value with units
                            return `${displayValue.toLocaleString("en-US")} scans`;
                          }}
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
                          label={(props: any): JSX.Element | null => {
                            // Safely convert index to number with fallback
                            const index: number = typeof props.index === 'number' 
                              ? props.index 
                              : (typeof props.index === 'string' ? Number(props.index) || 0 : 0);
                            const entry = props.payload || sortedData[index];
                            if (!entry || !entry.mostScannedDisease || entry.leafDiseaseCount === 0) return null;

                            // Safely convert x, y, and width to numbers with fallbacks
                            const x: number = typeof props.x === 'number' 
                              ? props.x 
                              : (typeof props.x === 'string' ? Number(props.x) || 0 : 0);
                            const y: number = typeof props.y === 'number' 
                              ? props.y 
                              : (typeof props.y === 'string' ? Number(props.y) || 0 : 0);
                            const width: number = typeof props.width === 'number' 
                              ? props.width 
                              : (typeof props.width === 'string' ? Number(props.width) || 0 : 0);

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
                          label={(props: any): JSX.Element | null => {
                            // Safely convert index to number with fallback
                            const index: number = typeof props.index === 'number' 
                              ? props.index 
                              : (typeof props.index === 'string' ? Number(props.index) || 0 : 0);
                            const entry = props.payload || sortedData[index];
                            if (!entry || !entry.mostScannedRipeness || entry.fruitRipenessCount === 0) return null;

                            // Safely convert x, y, and width to numbers with fallbacks
                            const x: number = typeof props.x === 'number' 
                              ? props.x 
                              : (typeof props.x === 'string' ? Number(props.x) || 0 : 0);
                            const y: number = typeof props.y === 'number' 
                              ? props.y 
                              : (typeof props.y === 'string' ? Number(props.y) || 0 : 0);
                            const width: number = typeof props.width === 'number' 
                              ? props.width 
                              : (typeof props.width === 'string' ? Number(props.width) || 0 : 0);

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

