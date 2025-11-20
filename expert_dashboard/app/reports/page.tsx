"use client";

import { motion } from "framer-motion";
import { useMemo, useState, useCallback, useEffect } from "react";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, TrendingUp, Camera, CheckCircle2, Download, Calendar } from "lucide-react";
import { supabase } from "@/components/supabase";
import {
  LineChart,
  Line,
  Area,
  AreaChart,
  BarChart,
  Bar,
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

import type { Scan, ValidationHistory } from "@/types";
import { getAiPrediction } from "@/types";

type Range = "daily" | "weekly" | "monthly" | "custom";

type TrendDatum = {
  period: string;
  scans: number;
};

type ValidationDatum = {
  period: string;
  validated: number;
  corrected: number;
  notValidated?: number;
};

// Disease color mapping (Healthy must be GREEN)
const DISEASE_COLORS: Record<string, string> = {
  "Cercospora": "#FB923C", // Orange - Disease color
  "Yellow Mosaic Virus": "#F59E0B", // Amber - Disease color
  "Healthy": "#22C55E", // Bright Green - Healthy
  "Unknown": "#6B7280", // Gray
  "Downy Mildew": "#3B82F6", // Blue - Disease color
  "Fusarium Wilt": "#EF4444", // Red - Disease color
};

// Ripeness color mapping
const RIPENESS_COLORS: Record<string, string> = {
  "Immature": "#3B82F6", // Blue
  "Mature": "#22C55E", // Green
  "Overmature": "#F59E0B", // Amber
  "Overripe": "#EF4444", // Red
  "Unknown": "#6B7280", // Gray
};

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];
const RANGE_LABELS: Record<Range, string> = {
  daily: "Today",
  weekly: "This Week",
  monthly: "This Month",
  custom: "Custom Range",
};

const ONE_DAY = 24 * 60 * 60 * 1000;
const HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: true });
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "long" });
const VALIDATED_GRADIENT_ID = "reports-validated-gradient";
const CORRECTED_GRADIENT_ID = "reports-corrected-gradient";

// Dark green color theme
const DARK_GREEN = "#388E3C";
const DARK_GREEN_LIGHT = "#4CAF50";

function normalizeToStartOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getRangeStart(range: Range, customStart?: Date) {
  if (range === "custom" && customStart) {
    return normalizeToStartOfDay(customStart);
  }
  const now = normalizeToStartOfDay(new Date());
  if (range === "daily") {
    return now;
  }
  if (range === "weekly") {
    const start = new Date(now);
    const day = start.getDay(); // 0 = Sunday, 1 = Monday, etc.
    // Go back to Sunday (start of week)
    start.setDate(start.getDate() - day);
    return start;
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getRangeEnd(range: Range, customEnd?: Date) {
  if (range === "custom" && customEnd) {
    const end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  const end = new Date();
  if (range === "daily") {
    end.setHours(23, 59, 59, 999);
  } else if (range === "weekly") {
    // For weekly, end should be end of today (current day)
    end.setHours(23, 59, 59, 999);
  } else if (range === "monthly") {
    // For monthly, end should be end of today (current day)
    end.setHours(23, 59, 59, 999);
  }
  return end;
}

function buildScansTrend(range: Range, scans: Scan[], rangeStart: Date, rangeEnd: Date): TrendDatum[] {
  if (range === "daily") {
    // Always show 8 time intervals: 3 AM, 6 AM, 9 AM, 12 PM, 3 PM, 6 PM, 9 PM, 12 AM
    const timeIntervals = [3, 6, 9, 12, 15, 18, 21, 0]; // Hours in 24-hour format
    const timeLabels = ["3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM", "12 AM"];
    const counts = new Map<number, number>();

    if (scans && scans.length > 0) {
      const base = normalizeToStartOfDay(rangeStart);
      const baseTime = base.getTime();
      const rangeEndTime = rangeEnd.getTime();

      scans.forEach((scan) => {
        if (!scan.created_at) return;
        try {
          const createdAt = new Date(scan.created_at);
          if (isNaN(createdAt.getTime())) return;
          const createdAtTime = createdAt.getTime();
          if (createdAtTime < baseTime || createdAtTime > rangeEndTime) return;
          
          const hour = createdAt.getHours();
          // Map hour to nearest interval
          // Handle hour 0 (midnight) specially - it should map to interval 0 (12 AM)
          let nearestInterval = 0;
          let minDiff = Infinity;
          timeIntervals.forEach((interval, idx) => {
            let diff: number;
            if (hour === 0 && interval === 0) {
              // Midnight maps to 12 AM
              diff = 0;
            } else if (hour === 0) {
              // Midnight (0) is closest to 12 AM (0) or 3 AM (3)
              diff = Math.min(interval, 24 - interval);
            } else if (interval === 0) {
              // 12 AM (0) is closest to midnight (0) or 9 PM (21)
              diff = Math.min(hour, 24 - hour);
            } else {
              diff = Math.abs(hour - interval);
            }
            if (diff < minDiff) {
              minDiff = diff;
              nearestInterval = idx;
            }
          });
          const intervalHour = timeIntervals[nearestInterval];
          counts.set(intervalHour, (counts.get(intervalHour) ?? 0) + 1);
        } catch {
          return;
        }
      });
    }

    return timeIntervals.map((hour, idx) => ({
      period: timeLabels[idx],
      scans: counts.get(hour) ?? 0,
    }));
  }

  const startDay = normalizeToStartOfDay(rangeStart);
  const endDay = normalizeToStartOfDay(rangeEnd);
  const totalDays = Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / ONE_DAY) + 1);

  const bucketCounts = new Map<number, number>();
  const rangeStartTime = startDay.getTime();
  const rangeEndTime = rangeEnd.getTime();
  
  scans.forEach((scan) => {
    if (!scan.created_at) return;
    try {
      const createdAt = new Date(scan.created_at);
      if (isNaN(createdAt.getTime())) return;
      const createdAtTime = createdAt.getTime();
      if (createdAtTime < rangeStartTime || createdAtTime > rangeEndTime) return;
      const scanDay = normalizeToStartOfDay(createdAt);
      const dayIndex = Math.floor((scanDay.getTime() - rangeStartTime) / ONE_DAY);
      if (dayIndex < 0 || dayIndex >= totalDays) return;
      bucketCounts.set(dayIndex, (bucketCounts.get(dayIndex) ?? 0) + 1);
    } catch {
      // Skip invalid dates
      return;
    }
  });

  if (range === "weekly") {
    // Always show 7 days: Sunday → Saturday
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    // Aggregate scans by day of week across the entire range
    const dayOfWeekCounts = new Map<number, number>();
    
    // Map all day indices to their day of week and aggregate counts
    for (let i = 0; i < totalDays; i++) {
      const actualDay = new Date(startDay);
      actualDay.setDate(startDay.getDate() + i);
      const dayOfWeek = actualDay.getDay();
      const scanCount = bucketCounts.get(i) ?? 0;
      dayOfWeekCounts.set(dayOfWeek, (dayOfWeekCounts.get(dayOfWeek) ?? 0) + scanCount);
    }
    
    return Array.from({ length: 7 }, (_, dayOfWeek) => ({
      period: days[dayOfWeek],
      scans: dayOfWeekCounts.get(dayOfWeek) ?? 0,
    }));
  }

  // Monthly - show full month names January → December
  // Only show months that are within the date range
  if (range === "monthly") {
    const months = ["January", "February", "March", "April", "May", "June", 
                     "July", "August", "September", "October", "November", "December"];
    const counts = new Map<number, number>();
    const monthSet = new Set<number>();
    
    // Determine which months are in the range
    const startMonth = rangeStart.getMonth();
    const endMonth = rangeEnd.getMonth();
    const startYear = rangeStart.getFullYear();
    const endYear = rangeEnd.getFullYear();
    
    if (startYear === endYear) {
      // Same year - include months from startMonth to endMonth
      for (let m = startMonth; m <= endMonth; m++) {
        monthSet.add(m);
      }
    } else {
      // Different years - include months from startMonth to December, and January to endMonth
      for (let m = startMonth; m < 12; m++) {
        monthSet.add(m);
      }
      for (let m = 0; m <= endMonth; m++) {
        monthSet.add(m);
      }
    }
    
    if (scans && scans.length > 0) {
      scans.forEach((scan) => {
        if (!scan.created_at) return;
        try {
          const createdAt = new Date(scan.created_at);
          if (isNaN(createdAt.getTime())) return;
          const createdAtTime = createdAt.getTime();
          if (createdAtTime < rangeStartTime || createdAtTime > rangeEndTime) return;
          const month = createdAt.getMonth(); // 0-11
          // Only count if month is in the range
          if (monthSet.has(month)) {
            counts.set(month, (counts.get(month) ?? 0) + 1);
          }
        } catch {
          return;
        }
      });
    }
    
    // Return all 12 months, but only show data for months in range
    return months.map((month, idx) => ({
      period: month,
      scans: counts.get(idx) ?? 0,
    }));
  }

  // Custom range - use day formatter
  const maxDays = Math.min(totalDays, 31);
  return Array.from({ length: maxDays }, (_, idx) => {
    const stamp = new Date(startDay);
    stamp.setDate(startDay.getDate() + idx);
    return {
      period: DAY_FORMATTER.format(stamp),
      scans: bucketCounts.get(idx) ?? 0,
    };
  });
}

// Build validation activity data for charts
// Counts scans where status !== "Pending Validation" (i.e., Validated or Corrected)
function buildValidationActivity(
  range: Range,
  scans: Scan[],
  rangeStart: Date,
  rangeEnd: Date
): ValidationDatum[] {
  if (range === "daily") {
    // Always show 8 time intervals: 3 AM, 6 AM, 9 AM, 12 PM, 3 PM, 6 PM, 9 PM, 12 AM
    const timeIntervals = [3, 6, 9, 12, 15, 18, 21, 0]; // Hours in 24-hour format
    const timeLabels = ["3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM", "12 AM"];
    const counts = new Map<number, number>();

    if (scans && scans.length > 0) {
      const base = normalizeToStartOfDay(rangeStart);
      const baseTime = base.getTime();
      const rangeEndTime = rangeEnd.getTime();

      scans.forEach((scan) => {
        // Only count scans where status !== "Pending Validation"
        if (!scan.status || scan.status === "Pending Validation") return;
        if (!scan.created_at) return;
        try {
          const createdAt = new Date(scan.created_at);
          if (isNaN(createdAt.getTime())) return;
          const createdAtTime = createdAt.getTime();
          if (createdAtTime < baseTime || createdAtTime > rangeEndTime) return;
          
          const hour = createdAt.getHours();
          // Map hour to nearest interval
          // Handle hour 0 (midnight) specially - it should map to interval 0 (12 AM)
          let nearestInterval = 0;
          let minDiff = Infinity;
          timeIntervals.forEach((interval, idx) => {
            let diff: number;
            if (hour === 0 && interval === 0) {
              // Midnight maps to 12 AM
              diff = 0;
            } else if (hour === 0) {
              // Midnight (0) is closest to 12 AM (0) or 3 AM (3)
              diff = Math.min(interval, 24 - interval);
            } else if (interval === 0) {
              // 12 AM (0) is closest to midnight (0) or 9 PM (21)
              diff = Math.min(hour, 24 - hour);
            } else {
              diff = Math.abs(hour - interval);
            }
            if (diff < minDiff) {
              minDiff = diff;
              nearestInterval = idx;
            }
          });
          const intervalHour = timeIntervals[nearestInterval];
          counts.set(intervalHour, (counts.get(intervalHour) ?? 0) + 1);
        } catch {
          return;
        }
      });
    }

    return timeIntervals.map((hour, idx) => ({
      period: timeLabels[idx],
      validated: counts.get(hour) ?? 0,
      corrected: 0,
    }));
  }

  const startDay = normalizeToStartOfDay(rangeStart);
  const endDay = normalizeToStartOfDay(rangeEnd);
  const totalDays = Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / ONE_DAY) + 1);
  const counts = new Map<number, number>();
  const rangeStartTime = startDay.getTime();
  const rangeEndTime = rangeEnd.getTime();

  scans.forEach((scan) => {
    // Only count scans where status !== "Pending Validation"
    if (!scan.status || scan.status === "Pending Validation") return;
    if (!scan.created_at) return;
    try {
      const createdAt = new Date(scan.created_at);
      if (isNaN(createdAt.getTime())) return;
      const createdAtTime = createdAt.getTime();
      if (createdAtTime < rangeStartTime || createdAtTime > rangeEndTime) return;
      const scanDay = normalizeToStartOfDay(createdAt);
      const dayIndex = Math.floor((scanDay.getTime() - rangeStartTime) / ONE_DAY);
      if (dayIndex < 0 || dayIndex >= totalDays) return;
      counts.set(dayIndex, (counts.get(dayIndex) ?? 0) + 1);
    } catch {
      // Skip invalid dates
      return;
    }
  });

  if (range === "weekly") {
    // Always show 7 days: Sunday → Saturday
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    // Aggregate scans by day of week across the entire range
    const dayOfWeekCounts = new Map<number, number>();
    
    // Map all day indices to their day of week and aggregate counts
    for (let i = 0; i < totalDays; i++) {
      const actualDay = new Date(startDay);
      actualDay.setDate(startDay.getDate() + i);
      const dayOfWeek = actualDay.getDay();
      const validatedCount = counts.get(i) ?? 0;
      dayOfWeekCounts.set(dayOfWeek, (dayOfWeekCounts.get(dayOfWeek) ?? 0) + validatedCount);
    }
    
    return Array.from({ length: 7 }, (_, dayOfWeek) => ({
      period: days[dayOfWeek],
      validated: dayOfWeekCounts.get(dayOfWeek) ?? 0,
      corrected: 0,
    }));
  }

  // Monthly - show full month names January → December
  // Only show months that are within the date range
  if (range === "monthly") {
    const months = ["January", "February", "March", "April", "May", "June", 
                     "July", "August", "September", "October", "November", "December"];
    const monthCounts = new Map<number, number>();
    const monthSet = new Set<number>();
    
    // Determine which months are in the range
    const startMonth = rangeStart.getMonth();
    const endMonth = rangeEnd.getMonth();
    const startYear = rangeStart.getFullYear();
    const endYear = rangeEnd.getFullYear();
    
    if (startYear === endYear) {
      // Same year - include months from startMonth to endMonth
      for (let m = startMonth; m <= endMonth; m++) {
        monthSet.add(m);
      }
    } else {
      // Different years - include months from startMonth to December, and January to endMonth
      for (let m = startMonth; m < 12; m++) {
        monthSet.add(m);
      }
      for (let m = 0; m <= endMonth; m++) {
        monthSet.add(m);
      }
    }
    
    if (scans && scans.length > 0) {
      scans.forEach((scan) => {
        // Only count scans where status !== "Pending Validation"
        if (!scan.status || scan.status === "Pending Validation") return;
        if (!scan.created_at) return;
        try {
          const createdAt = new Date(scan.created_at);
          if (isNaN(createdAt.getTime())) return;
          const createdAtTime = createdAt.getTime();
          if (createdAtTime < rangeStartTime || createdAtTime > rangeEndTime) return;
          const month = createdAt.getMonth(); // 0-11
          // Only count if month is in the range
          if (monthSet.has(month)) {
            monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
          }
        } catch {
          return;
        }
      });
    }
    
    // Return all 12 months, but only show data for months in range
    return months.map((month, idx) => ({
      period: month,
      validated: monthCounts.get(idx) ?? 0,
      corrected: 0,
    }));
  }

  // Custom range - use day formatter
  const maxDays = Math.min(totalDays, 31);
  return Array.from({ length: maxDays }, (_, idx) => {
    const stamp = new Date(startDay);
    stamp.setDate(startDay.getDate() + idx);
    return {
      period: DAY_FORMATTER.format(stamp),
      validated: counts.get(idx) ?? 0,
      corrected: 0,
    };
  });
}

export default function ReportsPage() {
  const { scans, validationHistory, loading, error, refreshData } = useData();
  const [range, setRange] = useState<Range>("daily");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  // Add current time state to ensure real-time updates for daily/weekly/monthly ranges
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Update current time every 30 seconds for real-time date range updates
  // This ensures new scans appear immediately in daily/weekly/monthly views
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000); // Update every 30 seconds for better real-time feel

    return () => clearInterval(interval);
  }, []);

  // Validate custom date range - optimized to prevent unnecessary re-renders
  useEffect(() => {
    if (range !== "custom" || !customStartDate || !customEndDate) return;
    
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
      // Swap the dates
      const temp = customStartDate;
      setCustomStartDate(customEndDate);
      setCustomEndDate(temp);
    }
  }, [range, customStartDate, customEndDate]);

  const rangeStart = useMemo(() => {
    try {
      if (range === "custom") {
        // For custom range, require both start and end dates
        if (customStartDate && customStartDate.trim() !== "") {
          const customStart = new Date(customStartDate);
          if (!isNaN(customStart.getTime())) {
            return getRangeStart(range, customStart);
          }
        }
        // If custom range is selected but dates aren't valid, fall back to today
        return normalizeToStartOfDay(new Date());
      }
      // For daily/weekly/monthly, use current time to ensure real-time updates
      return getRangeStart(range);
    } catch {
      // Fallback to daily if date parsing fails
      return normalizeToStartOfDay(new Date());
    }
  }, [range, customStartDate, currentTime]); // Add currentTime dependency
  
  const rangeEnd = useMemo(() => {
    try {
      if (range === "custom") {
        // For custom range, require both start and end dates
        if (customEndDate && customEndDate.trim() !== "") {
          const customEnd = new Date(customEndDate);
          if (!isNaN(customEnd.getTime())) {
            return getRangeEnd(range, customEnd);
          }
        }
        // If custom range is selected but dates aren't valid, fall back to end of today
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        return end;
      }
      // For daily/weekly/monthly, use end of current day for consistency
      // This ensures all scans from today are included
      return getRangeEnd(range);
    } catch {
      // Fallback to end of today if date parsing fails
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      return end;
    }
  }, [range, customEndDate, currentTime]); // Keep currentTime for real-time updates

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

  // Filter scans by date range - optimized with early returns and proper date comparison
  // This now properly includes new scans in real-time thanks to currentTime updates
  const filteredScans = useMemo(() => {
    if (!scans || scans.length === 0) return [];
    
    // Ensure rangeStart and rangeEnd are valid Date objects
    if (!rangeStart || !rangeEnd || isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
      return [];
    }
    
    const rangeStartTime = rangeStart.getTime();
    const rangeEndTime = rangeEnd.getTime();
    
    return scans.filter((scan) => {
      if (!scan.created_at) return false;
      try {
        const createdAt = new Date(scan.created_at);
        // Ensure valid date
        if (isNaN(createdAt.getTime())) return false;
        
        // Compare dates using timestamps for better performance
        const createdAtTime = createdAt.getTime();
        // Use inclusive comparison: >= start and <= end
        return createdAtTime >= rangeStartTime && createdAtTime <= rangeEndTime;
      } catch {
        return false;
      }
    });
  }, [scans, rangeStart, rangeEnd]);

  // Calculate total scans count - filtered by date range
  // This shows the count of scans within the selected date range (from scans table)
  // Daily → scans done today
  // Weekly → scans for the past 7 days
  // Monthly → scans for the current month
  // Custom → scans between startDate and endDate
  const totalScansCount = useMemo(() => {
    return filteredScans.length;
  }, [filteredScans]);

  // Filter validations by date range - optimized with timestamp comparison
  // This now properly includes new validations in real-time thanks to currentTime updates
  // Only include records with status = "Validated"
  const filteredValidations = useMemo(() => {
    if (!validationHistory || validationHistory.length === 0) return [];
    
    // Ensure rangeStart and rangeEnd are valid Date objects
    if (!rangeStart || !rangeEnd || isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
      return [];
    }
    
    const rangeStartTime = rangeStart.getTime();
    const rangeEndTime = rangeEnd.getTime();
    
    return validationHistory.filter((record) => {
      // Only include records with status = "Validated"
      if (record.status !== "Validated") return false;
      if (!record.validated_at) return false;
      try {
        const validatedAt = new Date(record.validated_at);
        // Ensure valid date
        if (isNaN(validatedAt.getTime())) return false;
        // Compare dates using timestamps for better performance
        const validatedAtTime = validatedAt.getTime();
        return validatedAtTime >= rangeStartTime && validatedAtTime <= rangeEndTime;
      } catch {
        return false;
      }
    });
  }, [validationHistory, rangeStart, rangeEnd]);

  // Calculate validated scans count: Count scans where status !== "Pending Validation"
  // Any scan with status "Validated" or "Corrected" counts as validated
  const validatedScansCount = useMemo(() => {
    if (!filteredScans || filteredScans.length === 0) {
      return 0;
    }
    
    // Count scans where status is NOT "Pending Validation"
    return filteredScans.filter((scan) => {
      return scan.status && scan.status !== "Pending Validation";
    }).length;
  }, [filteredScans]);

  // AI Accuracy Rate = (Total Confirmed by Expert ÷ Total Scans) × 100
  // Formula: Count of scans where expert confirmed (status = "Validated" in validation_history) / Total scans in filter range
  // IMPORTANT: Only count scans that exist in filteredScans AND have validation_history with status = "Validated"
  const aiAccuracyRate = useMemo(() => {
    // Get total scans in the filter range (from scans table)
    const totalScans = filteredScans.length;
    
    if (totalScans === 0) {
      return 0;
    }
    
    // Create a Set of scan UUIDs from filteredScans for fast lookup
    // Match by both scan_uuid and scan.id to handle different UUID formats
    const filteredScanUuids = new Set<string>();
    const filteredScanIds = new Set<number>();
    
    filteredScans.forEach((scan) => {
      if (scan.scan_uuid) {
        const scanUuid = String(scan.scan_uuid).trim().toLowerCase();
        if (scanUuid && scanUuid.length > 0) {
          filteredScanUuids.add(scanUuid);
        }
      }
      if (scan.id) {
        filteredScanIds.add(scan.id);
      }
    });
    
    // Count scans that were confirmed by expert (status = "Validated" in validation_history)
    // AND exist in the filtered scans (within date range)
    const confirmedScanUuids = new Set<string>();
    
    filteredValidations.forEach((validation) => {
      // Only count "Validated" status (confirmed), not "Corrected"
      if (validation.status === "Validated" && validation.scan_id) {
        const scanUuid = String(validation.scan_id).trim().toLowerCase();
        // Try matching by UUID first, then by scan.id if available
        if (scanUuid && scanUuid.length > 0) {
          if (filteredScanUuids.has(scanUuid)) {
            confirmedScanUuids.add(scanUuid);
          } else if (validation.scan?.id && filteredScanIds.has(validation.scan.id)) {
            // Fallback: match by scan.id if UUID doesn't match
            confirmedScanUuids.add(`id-${validation.scan.id}`);
          }
        }
      }
    });
    
    const confirmedCount = confirmedScanUuids.size;
    const rate = (confirmedCount / totalScans) * 100;
    return parseFloat(rate.toFixed(1));
  }, [filteredScans, filteredValidations]);

  const scansTrend = useMemo(() => buildScansTrend(range, filteredScans, rangeStart, rangeEnd), [range, filteredScans, rangeStart, rangeEnd]);
  
  // Build validation activity - counts scans where status !== "Pending Validation"
  const validationActivity = useMemo(() => {
    return buildValidationActivity(range, filteredScans, rangeStart, rangeEnd);
  }, [range, filteredScans, rangeStart, rangeEnd]);

  // Disease Distribution - Source of truth: leaf_disease_scans table, using disease_detected
  // This reflects what the farmer actually scanned, not expert corrections
  const diseaseDistribution = useMemo(() => {
    const counts = {
      Cercospora: 0,
      "Yellow Mosaic Virus": 0,
      Healthy: 0,
      Unknown: 0,
      "Fusarium Wilt": 0,
      "Downy Mildew": 0,
    };
    
    if (filteredScans && filteredScans.length > 0) {
      const leafScans = filteredScans.filter((scan) => scan.scan_type === "leaf_disease");
      
      leafScans.forEach((scan) => {
        try {
          // Use getAiPrediction helper to get disease_detected from leaf_disease_scans table
          // This works with the new schema (disease_detected) and backward compatibility (ai_prediction)
          // Do NOT use expert_validation - we want to show what was actually detected by AI
          const predictionText = (getAiPrediction(scan) || '').toLowerCase().trim();
          
          if (!predictionText) {
            counts.Unknown += 1;
            return;
          }
          
          // Match diseases in order of specificity (most specific first)
          // This ensures correct categorization even with similar keywords
          if (predictionText.includes("cercospora")) {
            counts.Cercospora += 1;
          } else if (predictionText.includes("downy mildew") || (predictionText.includes("downy") && predictionText.includes("mildew"))) {
            counts["Downy Mildew"] += 1;
          } else if (predictionText.includes("fusarium wilt") || (predictionText.includes("fusarium") && predictionText.includes("wilt"))) {
            counts["Fusarium Wilt"] += 1;
          } else if (predictionText.includes("yellow mosaic") || predictionText.includes("mosaic virus") || (predictionText.includes("yellow") && predictionText.includes("mosaic"))) {
            counts["Yellow Mosaic Virus"] += 1;
          } else if (predictionText.includes("healthy") || predictionText.includes("no disease") || predictionText.includes("normal")) {
            counts.Healthy += 1;
          } else {
            // If no specific disease is detected, mark as Unknown
            counts.Unknown += 1;
          }
        } catch (error) {
          // Log parsing errors only in development
          if (process.env.NODE_ENV === 'development') {
            console.error('[Reports] Failed to parse disease prediction:', error, scan);
          }
          counts.Unknown += 1;
        }
      });
    }

    // Return in specific order with all items (even if 0)
    const order = ["Healthy", "Cercospora", "Yellow Mosaic Virus", "Downy Mildew", "Fusarium Wilt", "Unknown"];
    return order.map((name) => ({
      name,
      value: counts[name as keyof typeof counts] || 0,
    }));
  }, [filteredScans]);

  // Ripeness Distribution - Source of truth: fruit_ripeness_scans table, using ripeness_stage
  // This reflects what the farmer actually scanned, not expert corrections
  const ripenessDistribution = useMemo(() => {
    const counts = {
      Unknown: 0,
      Immature: 0,
      Mature: 0,
      Overmature: 0,
      Overripe: 0,
    };
    
    if (filteredScans && filteredScans.length > 0) {
      const fruitScans = filteredScans.filter((scan) => scan.scan_type === "fruit_maturity");
      
      fruitScans.forEach((scan) => {
        try {
          // Use getAiPrediction helper to get ripeness_stage from fruit_ripeness_scans table
          // This works with the new schema (ripeness_stage) and backward compatibility (ai_prediction)
          // Do NOT use expert_validation - we want to show what was actually detected by AI
          const predictionText = (getAiPrediction(scan) || '').toLowerCase().trim();
          
          if (!predictionText) {
            counts.Unknown += 1;
            return;
          }
          
          // Match ripeness levels in order of specificity (most specific first)
          // This ensures correct categorization even with similar keywords
          // Check "overmature" and "overripe" BEFORE "mature" to avoid false matches
          // Use word boundaries or exact matches to prevent false positives
          if (
            predictionText.includes("overmature") || 
            predictionText.includes("over mature") || 
            predictionText.includes("over-mature")
          ) {
            counts.Overmature += 1;
          } else if (
            predictionText.includes("overripe") || 
            predictionText.includes("over ripe") || 
            predictionText.includes("over-ripe")
          ) {
            counts.Overripe += 1;
          } else if (
            predictionText.includes("immature") || 
            predictionText.includes("im mature") ||
            predictionText.includes("im-mature") ||
            predictionText.includes("unripe") || 
            predictionText.includes("under ripe") ||
            predictionText.includes("underripe")
          ) {
            counts.Immature += 1;
          } else if (
            // Match "mature" or "ripe" only if NOT part of "overmature", "immature", or "overripe"
            // Check that it's not preceded by "over" or "im" or "under"
            (predictionText.includes("mature") && 
             !predictionText.includes("overmature") && 
             !predictionText.includes("immature") &&
             !predictionText.includes("over mature") &&
             !predictionText.includes("im mature")) ||
            (predictionText.includes("ripe") && 
             !predictionText.includes("overripe") && 
             !predictionText.includes("unripe") &&
             !predictionText.includes("over ripe") &&
             !predictionText.includes("under ripe"))
          ) {
            // Only match "mature" or "ripe" if not part of compound words
            counts.Mature += 1;
          } else {
            // If no specific ripeness level is detected, mark as Unknown
            counts.Unknown += 1;
          }
        } catch (error) {
          // Log parsing errors only in development
          if (process.env.NODE_ENV === 'development') {
            console.error('[Reports] Failed to parse ripeness prediction:', error, scan);
          }
          counts.Unknown += 1;
        }
      });
    }

    // Return in specific order: Immature (Unripe), Overmature (Nearly Ripe), Mature (Ripe), Overripe, Unknown
    // Order matches reference design: Unripe → Nearly Ripe → Ripe → Overripe
    const order = ["Immature", "Overmature", "Mature", "Overripe", "Unknown"];
    return order.map((name) => ({
      name,
      value: counts[name as keyof typeof counts] || 0,
    }));
  }, [filteredScans]);

  // Memoize metric cards data to prevent unnecessary re-renders
  const metricCards = useMemo(() => [
    {
      icon: TrendingUp,
      label: "AI Accuracy Rate",
      value: `${aiAccuracyRate}%`,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
    },
    {
      icon: Camera,
      label: "Total Scans",
      value: totalScansCount.toLocaleString("en-US"),
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      icon: CheckCircle2,
      label: "Total Validated",
      value: validatedScansCount.toLocaleString("en-US"),
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
  ], [aiAccuracyRate, totalScansCount, validatedScansCount]);

  // CSV Export function
  const generateCSV = useCallback(() => {
    const headers = [
      "Date Range",
      "Start Date",
      "End Date",
      "Total Scans",
      "Total Validated",
      "AI Accuracy Rate (%)",
      "Cercospora",
      "Yellow Mosaic Virus",
      "Healthy",
      "Unknown",
      "Downy Mildew",
      "Fusarium Wilt",
      "Immature",
      "Mature",
      "Overmature",
      "Overripe",
    ];

    const diseaseCounts = diseaseDistribution.reduce((acc, item) => {
      acc[item.name] = item.value;
      return acc;
    }, {} as Record<string, number>);

    const ripenessCounts = ripenessDistribution.reduce((acc, item) => {
      acc[item.name] = item.value;
      return acc;
    }, {} as Record<string, number>);

    const startDateStr = rangeStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const endDateStr = rangeEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    const row = [
      dateRangeLabel,
      startDateStr,
      endDateStr,
      filteredScans.length,
      validatedScansCount,
      aiAccuracyRate.toFixed(1),
      diseaseCounts["Cercospora"] || 0,
      diseaseCounts["Yellow Mosaic Virus"] || 0,
      diseaseCounts["Healthy"] || 0,
      diseaseCounts["Unknown"] || 0,
      diseaseCounts["Downy Mildew"] || 0,
      diseaseCounts["Fusarium Wilt"] || 0,
      ripenessCounts["Immature"] || 0,
      ripenessCounts["Mature"] || 0,
      ripenessCounts["Overmature"] || 0,
      ripenessCounts["Overripe"] || 0,
    ];

    // Add BOM for UTF-8 to ensure proper Excel compatibility
    const BOM = '\uFEFF';
    const csvContent = BOM + [
      headers.join(","),
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    ].join("\n");

    return csvContent;
  }, [range, dateRangeLabel, rangeStart, rangeEnd, filteredScans, validatedScansCount, aiAccuracyRate, diseaseDistribution, ripenessDistribution]);

  const downloadCSV = useCallback((csvContent: string) => {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `bitter-scan-report-${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  // PDF Export function
  const generatePDF = useCallback(() => {
    if (typeof window === "undefined") return;

    // Create a printable HTML content
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow pop-ups to generate PDF");
      return;
    }

    const diseaseCounts = diseaseDistribution.reduce((acc, item) => {
      acc[item.name] = item.value;
      return acc;
    }, {} as Record<string, number>);

    const ripenessCounts = ripenessDistribution.reduce((acc, item) => {
      acc[item.name] = item.value;
      return acc;
    }, {} as Record<string, number>);

    // Format dates for display
    const startDateStr = rangeStart.toLocaleDateString("en-US", { 
      month: "long", 
      day: "numeric", 
      year: "numeric" 
    });
    const endDateStr = rangeEnd.toLocaleDateString("en-US", { 
      month: "long", 
      day: "numeric", 
      year: "numeric" 
    });
    const generatedDate = new Date().toLocaleDateString("en-US", { 
      month: "long", 
      day: "numeric", 
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    // Build scans trend table
    const scansTrendRows = scansTrend.length > 0 
      ? scansTrend.map(item => 
          `<tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${item.period}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${item.scans.toLocaleString()}</td>
          </tr>`
        ).join('')
      : '<tr><td colspan="2" style="padding: 8px; text-align: center; color: #666;">No data available</td></tr>';

    // Build validation activity table
    const validationActivityRows = validationActivity.length > 0
      ? validationActivity.map(item => 
          `<tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${item.period}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${item.validated.toLocaleString()}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${item.corrected.toLocaleString()}</td>
          </tr>`
        ).join('')
      : '<tr><td colspan="3" style="padding: 8px; text-align: center; color: #666;">No data available</td></tr>';

    // Calculate percentages for disease distribution
    const totalDiseaseScans = diseaseDistribution.reduce((sum, item) => sum + item.value, 0);
    const diseaseRows = diseaseDistribution.map(item => {
      const percentage = totalDiseaseScans > 0 ? ((item.value / totalDiseaseScans) * 100).toFixed(1) : "0.0";
      return `<tr>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.name}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${item.value.toLocaleString()}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${percentage}%</td>
      </tr>`;
    }).join('');

    // Calculate percentages for ripeness distribution
    const totalRipenessScans = ripenessDistribution.reduce((sum, item) => sum + item.value, 0);
    const ripenessRows = ripenessDistribution.map(item => {
      const percentage = totalRipenessScans > 0 ? ((item.value / totalRipenessScans) * 100).toFixed(1) : "0.0";
      return `<tr>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.name}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${item.value.toLocaleString()}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${percentage}%</td>
      </tr>`;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>BitterScan Analytics Report - ${dateRangeLabel}</title>
          <meta charset="UTF-8">
          <style>
            * { 
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
              padding: 40px 30px; 
              color: #1a1a1a; 
              background: #ffffff;
              line-height: 1.6;
            }
            .header {
              border-bottom: 3px solid #388E3C;
              padding-bottom: 20px;
              margin-bottom: 30px;
            }
            .header h1 {
              color: #388E3C;
              font-size: 32px;
              font-weight: 700;
              margin-bottom: 10px;
            }
            .header .subtitle {
              color: #666;
              font-size: 14px;
              margin-top: 5px;
            }
            .report-info {
              background: #f8f9fa;
              padding: 15px 20px;
              border-radius: 6px;
              margin-bottom: 30px;
              border-left: 4px solid #388E3C;
            }
            .report-info p {
              margin: 5px 0;
              color: #333;
              font-size: 14px;
            }
            .report-info strong {
              color: #1a1a1a;
              font-weight: 600;
            }
            h2 { 
              color: #388E3C; 
              margin-top: 35px; 
              margin-bottom: 18px;
              font-size: 20px;
              font-weight: 600;
              border-bottom: 2px solid #e0e0e0;
              padding-bottom: 8px;
            }
            .metrics-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
              margin: 25px 0;
            }
            .metric-card {
              background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%);
              border: 2px solid #e0e0e0;
              border-radius: 8px;
              padding: 20px;
              text-align: center;
              box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            }
            .metric-label {
              font-size: 13px;
              color: #666;
              font-weight: 500;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-bottom: 10px;
            }
            .metric-value {
              font-size: 36px;
              font-weight: 700;
              color: #388E3C;
              line-height: 1.2;
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin: 25px 0;
              page-break-inside: avoid;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            th { 
              background: linear-gradient(135deg, #388E3C 0%, #2F7A33 100%);
              color: #ffffff;
              padding: 12px 15px;
              text-align: left;
              font-weight: 600;
              font-size: 13px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            th:last-child {
              text-align: right;
            }
            td { 
              border: 1px solid #e0e0e0;
              padding: 10px 15px;
              color: #333;
              font-size: 14px;
            }
            tr:nth-child(even) { 
              background-color: #f8f9fa;
            }
            tr:hover {
              background-color: #f0f7f1;
            }
            .section {
              margin-bottom: 40px;
              page-break-inside: avoid;
            }
            .section:last-child {
              margin-bottom: 0;
            }
            .footer {
              margin-top: 50px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
              text-align: center;
              color: #666;
              font-size: 12px;
            }
            @media print { 
              body { 
                margin: 0; 
                padding: 20px 15px;
              }
              .no-print { 
                display: none; 
              }
              @page { 
                margin: 1.5cm;
                size: A4;
              }
              h2 {
                page-break-after: avoid;
              }
              .section {
                page-break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>BitterScan Analytics Report</h1>
            <div class="subtitle">Comprehensive Insights into Scan Activity and AI Performance</div>
          </div>

          <div class="report-info">
            <p><strong>Report Period:</strong> ${dateRangeLabel}</p>
            <p><strong>Date Range:</strong> ${startDateStr} to ${endDateStr}</p>
            <p><strong>Generated On:</strong> ${generatedDate}</p>
          </div>
          
          <div class="section">
            <h2>Executive Summary</h2>
            <div class="metrics-grid">
              <div class="metric-card">
                <div class="metric-label">Total Scans</div>
                <div class="metric-value">${filteredScans.length.toLocaleString()}</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Total Validated</div>
                <div class="metric-value">${validatedScansCount.toLocaleString()}</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">AI Accuracy Rate</div>
                <div class="metric-value">${aiAccuracyRate.toFixed(1)}%</div>
              </div>
            </div>
            <p style="margin-top: 20px; color: #555; font-size: 14px; line-height: 1.8;">
              This report provides a comprehensive analysis of scan activity and AI performance metrics 
              for the selected time period. The data includes all scan types (leaf disease detection 
              and fruit maturity assessment) processed through the BitterScan system.
            </p>
          </div>

          ${scansTrend.length > 0 ? `
          <div class="section">
            <h2>Scans Trend Analysis</h2>
            <p style="margin-bottom: 15px; color: #555; font-size: 14px;">
              The following table shows the distribution of scans across the selected time period, 
              providing insights into scan activity patterns.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th style="text-align: right;">Number of Scans</th>
                </tr>
              </thead>
              <tbody>
                ${scansTrendRows}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${validationActivity.length > 0 ? `
          <div class="section">
            <h2>Validation Activity</h2>
            <p style="margin-bottom: 15px; color: #555; font-size: 14px;">
              This section tracks expert validation activities, showing the number of scans that 
              were validated as correct versus those that required correction.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th style="text-align: right;">Validated</th>
                  <th style="text-align: right;">Corrected</th>
                </tr>
              </thead>
              <tbody>
                ${validationActivityRows}
              </tbody>
            </table>
          </div>
          ` : ''}

          <div class="section">
            <h2>Disease Distribution Analysis</h2>
            <p style="margin-bottom: 15px; color: #555; font-size: 14px;">
              Distribution of leaf disease detection results across all disease types identified 
              during the selected period.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Disease Type</th>
                  <th style="text-align: right;">Count</th>
                  <th style="text-align: right;">Percentage</th>
                </tr>
              </thead>
              <tbody>
                ${diseaseRows}
              </tbody>
            </table>
          </div>

          <div class="section">
            <h2>Fruit Ripeness Distribution</h2>
            <p style="margin-bottom: 15px; color: #555; font-size: 14px;">
              Distribution of fruit maturity assessment results, showing the breakdown of 
              ripeness levels detected during the selected period.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Ripeness Level</th>
                  <th style="text-align: right;">Count</th>
                  <th style="text-align: right;">Percentage</th>
                </tr>
              </thead>
              <tbody>
                ${ripenessRows}
              </tbody>
            </table>
          </div>

          <div class="footer">
            <p>This report was generated automatically by the BitterScan Expert Dashboard.</p>
            <p>For questions or support, please contact your system administrator.</p>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }, [range, dateRangeLabel, rangeStart, rangeEnd, filteredScans, validatedScansCount, aiAccuracyRate, diseaseDistribution, ripenessDistribution, scansTrend, validationActivity]);

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
        <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Reports &amp; Analytics</h1>
              <p className="text-gray-600 text-base">Comprehensive insights into scan activity and AI performance</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
                {RANGE_OPTIONS.filter(opt => opt.value !== "custom").map((option) => (
                  <Button
                    key={option.value}
                    variant={range === option.value ? "default" : "ghost"}
                    size="sm"
                    className={`text-sm font-medium ${range === option.value ? "bg-[#388E3C] text-white hover:bg-[#2F7A33]" : "text-gray-700 hover:bg-gray-100"}`}
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
                className={`text-sm font-medium ${range === "custom" ? "bg-[#388E3C] text-white hover:bg-[#2F7A33]" : ""}`}
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
                <Calendar className="h-4 w-4 mr-1" />
                Custom
              </Button>
              {showCustomPicker && range === "custom" && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent"
                    max={customEndDate || new Date().toISOString().split('T')[0]}
                  />
                  <span className="text-gray-500 font-medium">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent"
                    min={customStartDate || undefined}
                    max={new Date().toISOString().split('T')[0]}
                  />
                  {customStartDate && customEndDate && (
                    <span className="text-xs text-gray-600 ml-2">
                      ({dateRangeLabel})
                    </span>
                  )}
                </div>
              )}
              {/* Export Buttons Group */}
              <div className="flex items-center gap-2 ml-2 pl-3 border-l border-gray-200">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2 text-sm font-medium hover:bg-gray-50 transition-colors"
                  onClick={() => {
                    const csvContent = generateCSV();
                    downloadCSV(csvContent);
                  }}
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Export CSV</span>
                  <span className="sm:hidden">CSV</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2 text-sm font-medium hover:bg-gray-50 transition-colors"
                  onClick={() => generatePDF()}
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Export PDF</span>
                  <span className="sm:hidden">PDF</span>
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {metricCards.map((metric, idx) => {
              const Icon = metric.icon;
              return (
                <Card key={idx} className="shadow-sm hover:shadow-lg transition-all duration-200 border border-gray-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-gray-700">{metric.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between pt-0">
                    <p className="text-4xl font-bold text-gray-900">{metric.value}</p>
                    <div className={`${metric.bgColor} p-3 rounded-lg`}>
                      <Icon className={`h-6 w-6 ${metric.color} flex-shrink-0`} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <ChartCard title={`AI Accuracy Rate • ${dateRangeLabel}`}>
            {(() => {
              let level = "Needs Improvement";
              let color = "#ef4444";
              if (aiAccuracyRate >= 90) {
                level = "Excellent";
                color = "#22c55e";
              } else if (aiAccuracyRate >= 75) {
                level = "Good";
                color = "#3b82f6";
              } else if (aiAccuracyRate >= 50) {
                level = "Average";
                color = "#f59e0b";
              }

              const pieData = [
                { name: "Accuracy", value: aiAccuracyRate },
                { name: "Remaining", value: Math.max(0, 100 - aiAccuracyRate) },
              ];

              return (
                <div className="flex flex-col gap-5">
                  <div className="w-full">
                    <div className="relative mx-auto" style={{ maxWidth: 380 }}>
                      <ResponsiveContainer width="100%" height={260}>
                        <RechartsPieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={65}
                            outerRadius={100}
                            startAngle={90}
                            endAngle={-270}
                            paddingAngle={2}
                            dataKey="value"
                            isAnimationActive={true}
                            animationDuration={800}
                          >
                            <Cell key="accuracy" fill={color} stroke="#fff" strokeWidth={2} />
                            <Cell key="remaining" fill="#e5e7eb" stroke="#fff" strokeWidth={2} />
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "1px solid #e5e7eb",
                              borderRadius: "6px",
                              fontSize: "12px",
                            }}
                          />
                        </RechartsPieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <p className="text-4xl font-bold text-gray-900">{aiAccuracyRate}%</p>
                        <p className="text-sm font-medium text-gray-600">{level}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="flex items-center justify-start gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#22c55e" }} />
                      <div className="text-sm">
                        <p className="font-semibold text-gray-900 leading-5">Excellent</p>
                        <p className="text-gray-600 text-xs">90%–100%</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-start gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#3b82f6" }} />
                      <div className="text-sm">
                        <p className="font-semibold text-gray-900 leading-5">Good</p>
                        <p className="text-gray-600 text-xs">75%–89%</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-start gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
                      <div className="text-sm">
                        <p className="font-semibold text-gray-900 leading-5">Average</p>
                        <p className="text-gray-600 text-xs">50%–74%</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-start gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#ef4444" }} />
                      <div className="text-sm">
                        <p className="font-semibold text-gray-900 leading-5">Needs Improvement</p>
                        <p className="text-gray-600 text-xs">0%–49%</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title={`Scans Trend • ${dateRangeLabel}`}>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={scansTrend} margin={{ top: 10, right: 20, left: 0, bottom: range === "monthly" ? 50 : 10 }}>
                  <defs>
                    <linearGradient id="scansAreaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={DARK_GREEN} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={DARK_GREEN} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="period" 
                    stroke="#6b7280" 
                    fontSize={12} 
                    tick={{ fill: "#6b7280" }}
                    tickLine={false}
                    interval={0}
                    angle={range === "monthly" ? -45 : 0}
                    textAnchor={range === "monthly" ? "end" : "middle"}
                    height={range === "monthly" ? 80 : 30}
                  />
                  <YAxis 
                    stroke="#6b7280" 
                    fontSize={12} 
                    tick={{ fill: "#6b7280" }} 
                    allowDecimals={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                      fontSize: "12px",
                      boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                    }}
                    formatter={(value: number) => [`${value} scans`, "Scans"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="scans"
                    stroke={DARK_GREEN}
                    strokeWidth={2.5}
                    fill="url(#scansAreaGradient)"
                    name="Scans"
                    dot={{ fill: DARK_GREEN, r: 4, strokeWidth: 2, stroke: "#fff" }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={`Validated Activity • ${dateRangeLabel}`}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart 
                  data={validationActivity} 
                  margin={{ top: 20, right: 30, left: 0, bottom: range === "monthly" ? 50 : 10 }}
                  barCategoryGap="15%"
                  barSize={range === "daily" ? 30 : range === "weekly" ? 35 : 25}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis 
                    dataKey="period" 
                    stroke="#6b7280" 
                    fontSize={12} 
                    tick={{ fill: "#6b7280" }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={range === "monthly" ? -45 : 0}
                    textAnchor={range === "monthly" ? "end" : "middle"}
                    height={range === "monthly" ? 80 : 30}
                  />
                  <YAxis 
                    stroke="#6b7280" 
                    fontSize={12} 
                    tick={{ fill: "#6b7280" }} 
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      fontSize: "12px",
                      padding: "8px 12px",
                      boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                    }}
                    formatter={(value: number, name: string) => [`${value}`, name]}
                    cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                  />
                  <Bar
                    dataKey="validated"
                    fill={DARK_GREEN}
                    name="Validated"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-6 pt-4 border-t border-gray-200 mt-4">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-[var(--primary)]"></div>
                  <span className="text-sm font-medium text-gray-700">Validated</span>
                </div>
              </div>
            </ChartCard>
          </div>

          {/* Disease and Ripeness Distribution Sections - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Disease Distribution Section */}
            <Card className="shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold text-gray-900">
                  Disease Distribution
                </CardTitle>
                <p className="text-sm text-gray-600 mt-2">Leaf disease scan analysis for {dateRangeLabel.toLowerCase()}</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="flex justify-center">
                    {diseaseDistribution.some((item) => item.value > 0) ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <RechartsPieChart>
                          <Pie
                            data={diseaseDistribution.filter((item) => item.value > 0)}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={false}
                            innerRadius={60}
                            outerRadius={100}
                            fill="#8884d8"
                            dataKey="value"
                            animationBegin={0}
                            animationDuration={800}
                          >
                            {diseaseDistribution.filter((item) => item.value > 0).map((entry, index) => (
                              <Cell 
                                key={`disease-cell-${index}`} 
                                fill={DISEASE_COLORS[entry.name] || "#6B7280"}
                                stroke="#ffffff"
                                strokeWidth={2}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => [
                              `${value.toLocaleString("en-US")} cases`,
                              name
                            ]}
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "1px solid #e5e7eb",
                              borderRadius: "8px",
                              fontSize: "13px",
                              padding: "10px 14px",
                              boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                            }}
                          />
                        </RechartsPieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-[280px] w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50">
                        <p className="text-sm text-gray-500">No data to display</p>
                      </div>
                    )}
                  </div>
                  
                  {/* Legend - Show all categories */}
                  {diseaseDistribution.length > 0 && (
                    <div className="pt-4 border-t border-gray-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {diseaseDistribution.map((entry) => {
                          const total = diseaseDistribution.reduce((sum, item) => sum + item.value, 0);
                          const percentage = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0.0";
                          const color = DISEASE_COLORS[entry.name] || "#6B7280";
                          
                          return (
                            <div
                              key={entry.name}
                              className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                                entry.value === 0 
                                  ? "bg-gray-50/50 opacity-60" 
                                  : "bg-gray-50 hover:bg-gray-100"
                              }`}
                            >
                              <div 
                                className="w-4 h-4 rounded-full flex-shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <div className="flex-1 min-w-0 flex items-center justify-between">
                                <p className={`text-sm font-medium ${
                                  entry.value === 0 ? "text-gray-500" : "text-gray-900"
                                }`}>
                                  {entry.name}
                                </p>
                                <div className="flex items-baseline gap-2 ml-2">
                                  <span className={`text-sm font-semibold ${
                                    entry.value === 0 ? "text-gray-400" : "text-gray-900"
                                  }`}>
                                    {entry.value.toLocaleString("en-US")}
                                  </span>
                                  {total > 0 && (
                                    <span className="text-xs text-gray-500 font-medium">
                                      ({percentage}%)
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Ripeness Distribution Section */}
            <Card className="shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold text-gray-900">
                  Ripeness Distribution
                </CardTitle>
                <p className="text-sm text-gray-600 mt-2">Fruit maturity scan analysis for {dateRangeLabel.toLowerCase()}</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="flex justify-center">
                    {ripenessDistribution.some((item) => item.value > 0) ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <RechartsPieChart>
                          <Pie
                            data={ripenessDistribution.filter((item) => item.value > 0)}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={false}
                            innerRadius={60}
                            outerRadius={100}
                            fill="#8884d8"
                            dataKey="value"
                            animationBegin={0}
                            animationDuration={800}
                          >
                            {ripenessDistribution.filter((item) => item.value > 0).map((entry, index) => (
                              <Cell 
                                key={`ripeness-cell-${index}`} 
                                fill={RIPENESS_COLORS[entry.name] || "#6B7280"}
                                stroke="#ffffff"
                                strokeWidth={2}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => [
                              `${value.toLocaleString("en-US")} items`,
                              name
                            ]}
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "1px solid #e5e7eb",
                              borderRadius: "8px",
                              fontSize: "13px",
                              padding: "10px 14px",
                              boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                            }}
                          />
                        </RechartsPieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-[280px] w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50">
                        <p className="text-sm text-gray-500">No data to display</p>
                      </div>
                    )}
                  </div>
                  
                  {/* Legend - Show all categories */}
                  {ripenessDistribution.length > 0 && (
                    <div className="pt-4 border-t border-gray-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {ripenessDistribution.map((entry) => {
                          const total = ripenessDistribution.reduce((sum, item) => sum + item.value, 0);
                          const percentage = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0.0";
                          const color = RIPENESS_COLORS[entry.name] || "#6B7280";
                          
                          return (
                            <div
                              key={entry.name}
                              className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                                entry.value === 0 
                                  ? "bg-gray-50/50 opacity-60" 
                                  : "bg-gray-50 hover:bg-gray-100"
                              }`}
                            >
                              <div 
                                className="w-4 h-4 rounded-full flex-shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <div className="flex-1 min-w-0 flex items-center justify-between">
                                <p className={`text-sm font-medium ${
                                  entry.value === 0 ? "text-gray-500" : "text-gray-900"
                                }`}>
                                  {entry.name}
                                </p>
                                <div className="flex items-baseline gap-2 ml-2">
                                  <span className={`text-sm font-semibold ${
                                    entry.value === 0 ? "text-gray-400" : "text-gray-900"
                                  }`}>
                                    {entry.value.toLocaleString("en-US")}
                                  </span>
                                  {total > 0 && (
                                    <span className="text-xs text-gray-500 font-medium">
                                      ({percentage}%)
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

