"use client";

import { motion } from "framer-motion";
import { useMemo, useState, useCallback, useEffect } from "react";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, TrendingUp, Camera, CheckCircle2, Download, Calendar, Clock, Clock3 } from "lucide-react";
import { supabase } from "@/components/supabase";
import {
  LineChart,
  Line,
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
import { useData } from "@/components/DataContext";
import toast from "react-hot-toast";

import type { Scan, ValidationHistory } from "@/types";
import { getAiPrediction } from "@/types";
import { parseTimestampToLocal, getLocalHour, normalizeToStartOfDay, normalizeToEndOfDay, getLocalDateComponents } from "@/utils/timezone";

type Range = "daily" | "weekly" | "monthly" | "custom";

type TrendDatum = {
  period: string;
  scans: number;
};

type ValidationDatum = {
  period: string;
  validated: number;
  corrected: number;
};

// Disease color mapping (Healthy must be GREEN)
const DISEASE_COLORS: Record<string, string> = {
  "Healthy": "#22C55E", // Bright Green - ALWAYS GREEN
  "Cercospora": "#EF4444", // Red
  "Yellow Mosaic Virus": "#F59E0B", // Amber/Orange
  "Downy Mildew": "#3B82F6", // Blue
  "Fusarium Wilt": "#8B5CF6", // Purple
  "Unknown": "#6B7280", // Gray
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
const HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" });
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

// Real-time Clock Component
function RealTimeClock() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  return (
    <div className="flex items-center justify-between w-full text-white">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4" />
        <span className="font-semibold">{formatDate(currentTime)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Clock3 className="h-4 w-4" />
        <span className="font-bold tabular-nums">{formatTime(currentTime)}</span>
      </div>
    </div>
  );
}

// UTC-based date normalization for consistent time display
function normalizeToStartOfDayUTC(date: Date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function getRangeStart(range: Range, customStart?: Date) {
  if (range === "custom" && customStart) {
    return normalizeToStartOfDayUTC(customStart);
  }
  const now = normalizeToStartOfDayUTC(new Date());
  if (range === "daily") {
    return now;
  }
  if (range === "weekly") {
    const start = new Date(now);
    const day = start.getUTCDay(); // Use UTC day
    start.setUTCDate(start.getUTCDate() - day); // Go back to Sunday in UTC
    return start;
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return start;
}

function getRangeEnd(range: Range, customEnd?: Date) {
  if (range === "custom" && customEnd) {
    const end = new Date(customEnd);
    end.setUTCHours(23, 59, 59, 999);
    return end;
  }
  const end = new Date();
  if (range === "daily") {
    end.setUTCHours(23, 59, 59, 999);
  }
  return end;
}

function buildScansTrend(range: Range, scans: Scan[], rangeStart: Date, rangeEnd: Date): TrendDatum[] {
  if (range === "daily") {
    // Today View: Always show all 24 hours (12 AM to 11 PM)
    const base = normalizeToStartOfDayUTC(rangeStart);
    const counts = new Map<number, number>();

    // Count scans per hour if we have data
    if (scans && scans.length > 0) {
      scans.forEach((scan) => {
        if (!scan.created_at) return;
        try {
          const createdAt = new Date(scan.created_at);
          if (isNaN(createdAt.getTime())) return;
          if (createdAt < base || createdAt > rangeEnd) return;
          const hour = createdAt.getUTCHours(); // Use UTC hour directly
          counts.set(hour, (counts.get(hour) ?? 0) + 1);
        } catch {
          // Skip invalid dates
          return;
        }
      });
    }

    // Always return all 24 hours, starting from 0
    return Array.from({ length: 24 }, (_, hour) => {
      // Create hour start time in Philippine timezone
      const hourStart = new Date(base.getTime() + (hour * 60 * 60 * 1000));
      return {
        period: HOUR_FORMATTER.format(hourStart),
        scans: counts.get(hour) ?? 0,
      };
    });
  }

  const startDay = normalizeToStartOfDayUTC(rangeStart);
  const endDay = normalizeToStartOfDayUTC(rangeEnd);
  const totalDays = Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / ONE_DAY) + 1);

  const bucketCounts = new Map<number, number>();
  
  // Count scans per day if we have data
  if (scans && scans.length > 0) {
    scans.forEach((scan) => {
      if (!scan.created_at) return;
      try {
        const createdAt = new Date(scan.created_at);
        if (isNaN(createdAt.getTime())) return;
        if (createdAt < startDay || createdAt > rangeEnd) return;
        const dayIndex = Math.floor((normalizeToStartOfDayUTC(createdAt).getTime() - startDay.getTime()) / ONE_DAY);
        if (dayIndex < 0 || dayIndex >= totalDays) return;
        bucketCounts.set(dayIndex, (bucketCounts.get(dayIndex) ?? 0) + 1);
      } catch {
        // Skip invalid dates
        return;
      }
    });
  }

  if (range === "weekly") {
    // This Week View: Always show all 7 days (Sunday to Saturday)
    return Array.from({ length: 7 }, (_, idx) => {
      const stamp = new Date(startDay);
      stamp.setDate(startDay.getDate() + idx);
      return {
        period: WEEKDAY_FORMATTER.format(stamp),
        scans: bucketCounts.get(idx) ?? 0,
      };
    });
  }

  // This Month View: Show day numbers (1, 2, 3...)
  return Array.from({ length: totalDays }, (_, idx) => {
    const dayNumber = idx + 1;
    return {
      period: dayNumber.toString(),
      scans: bucketCounts.get(idx) ?? 0,
    };
  });
}

function buildValidationActivity(
  range: Range,
  validations: ValidationHistory[],
  rangeStart: Date,
  rangeEnd: Date
): ValidationDatum[] {
  if (!validations || validations.length === 0) {
    // Return empty array with at least one entry for daily to show empty state
    if (range === "daily") {
      return [{ period: "12 AM", validated: 0, corrected: 0 }];
    }
    return [];
  }

  if (range === "daily") {
    const base = normalizeToStartOfDayUTC(rangeStart);
    const isToday = rangeEnd.toDateString() === base.toDateString();
    const currentHour = isToday ? Math.min(rangeEnd.getUTCHours() + 1, 24) : 24;
    const counts = new Map<number, { validated: number; corrected: number }>();

    validations.forEach((record) => {
      if (!record.validated_at) return;
      try {
        const validatedAt = new Date(record.validated_at);
        if (isNaN(validatedAt.getTime())) return;
        if (validatedAt < base || validatedAt > rangeEnd) return;
        const hour = validatedAt.getUTCHours(); // Use UTC hour directly
        const bucket = counts.get(hour) ?? { validated: 0, corrected: 0 };
        if (record.status === "Validated") {
          bucket.validated += 1;
        } else if (record.status === "Corrected") {
          bucket.corrected += 1;
        }
        counts.set(hour, bucket);
      } catch {
        // Skip invalid dates
        return;
      }
    });

    return Array.from({ length: Math.max(currentHour, 1) }, (_, hour) => {
      // Create hour start time in Philippine timezone
      const hourStart = new Date(base.getTime() + (hour * 60 * 60 * 1000));
      const bucket = counts.get(hour);
      return {
        period: HOUR_FORMATTER.format(hourStart),
        validated: bucket?.validated ?? 0,
        corrected: bucket?.corrected ?? 0,
      };
    });
  }

  const startDay = normalizeToStartOfDayUTC(rangeStart);
  const endDay = normalizeToStartOfDayUTC(rangeEnd);
  const totalDays = Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / ONE_DAY) + 1);
  const counts = new Map<number, { validated: number; corrected: number }>();

  validations.forEach((record) => {
    if (!record.validated_at) return;
    try {
      const validatedAt = new Date(record.validated_at);
      if (isNaN(validatedAt.getTime())) return;
      if (validatedAt < startDay || validatedAt > rangeEnd) return;
      const dayIndex = Math.floor((normalizeToStartOfDayUTC(validatedAt).getTime() - startDay.getTime()) / ONE_DAY);
      if (dayIndex < 0 || dayIndex >= totalDays) return;
      const bucket = counts.get(dayIndex) ?? { validated: 0, corrected: 0 };
      if (record.status === "Validated") {
        bucket.validated += 1;
      } else if (record.status === "Corrected") {
        bucket.corrected += 1;
      }
      counts.set(dayIndex, bucket);
    } catch {
      // Skip invalid dates
      return;
    }
  });

  if (range === "weekly") {
    const buckets = Math.min(7, totalDays);
    return Array.from({ length: buckets }, (_, idx) => {
      const stamp = new Date(startDay);
      stamp.setDate(startDay.getDate() + idx);
      const bucket = counts.get(idx);
      return {
        period: WEEKDAY_FORMATTER.format(stamp),
        validated: bucket?.validated ?? 0,
        corrected: bucket?.corrected ?? 0,
      };
    });
  }

  // Monthly
  return Array.from({ length: totalDays }, (_, idx) => {
    const stamp = new Date(startDay);
    stamp.setDate(startDay.getDate() + idx);
    const bucket = counts.get(idx);
    return {
      period: DAY_FORMATTER.format(stamp),
      validated: bucket?.validated ?? 0,
      corrected: bucket?.corrected ?? 0,
    };
  });
}

type SuccessRateDatum = {
  period: string;
  successRate: number;
  totalScans: number;
  validatedScans: number;
};

function buildSuccessRateTrend(
  range: Range,
  scans: Scan[],
  rangeStart: Date,
  rangeEnd: Date
): SuccessRateDatum[] {
  if (range === "daily") {
    // Today View: Show hourly success rate
    const base = normalizeToStartOfDayUTC(rangeStart);
    const scanCounts = new Map<number, number>();
    const validatedCounts = new Map<number, number>();

    if (scans && scans.length > 0) {
      scans.forEach((scan) => {
        if (!scan.created_at) return;
        try {
          const createdAt = new Date(scan.created_at);
          if (isNaN(createdAt.getTime())) return;
          if (createdAt < base || createdAt > rangeEnd) return;
          const hour = createdAt.getUTCHours(); // Use UTC hour directly
          scanCounts.set(hour, (scanCounts.get(hour) ?? 0) + 1);
          
          // Count validated/corrected scans
          if (scan.status === "Validated" || scan.status === "Corrected") {
            validatedCounts.set(hour, (validatedCounts.get(hour) ?? 0) + 1);
          }
        } catch {
          return;
        }
      });
    }

    // Return all 24 hours
    return Array.from({ length: 24 }, (_, hour) => {
      // Create hour start time in Philippine timezone
      const hourStart = new Date(base.getTime() + (hour * 60 * 60 * 1000));
      const total = scanCounts.get(hour) ?? 0;
      const validated = validatedCounts.get(hour) ?? 0;
      const rate = total > 0 ? (validated / total) * 100 : 0;
      
      return {
        period: HOUR_FORMATTER.format(hourStart),
        successRate: parseFloat(rate.toFixed(1)),
        totalScans: total,
        validatedScans: validated,
      };
    });
  }

  const startDay = normalizeToStartOfDayUTC(rangeStart);
  const endDay = normalizeToStartOfDayUTC(rangeEnd);
  const totalDays = Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / ONE_DAY) + 1);

  const scanCounts = new Map<number, number>();
  const validatedCounts = new Map<number, number>();

  if (scans && scans.length > 0) {
    scans.forEach((scan) => {
      if (!scan.created_at) return;
      try {
        const createdAt = new Date(scan.created_at);
        if (isNaN(createdAt.getTime())) return;
        if (createdAt < startDay || createdAt > rangeEnd) return;
        const dayIndex = Math.floor((normalizeToStartOfDayUTC(createdAt).getTime() - startDay.getTime()) / ONE_DAY);
        if (dayIndex < 0 || dayIndex >= totalDays) return;
        
        scanCounts.set(dayIndex, (scanCounts.get(dayIndex) ?? 0) + 1);
        
        // Count validated/corrected scans
        if (scan.status === "Validated" || scan.status === "Corrected") {
          validatedCounts.set(dayIndex, (validatedCounts.get(dayIndex) ?? 0) + 1);
        }
      } catch {
        return;
      }
    });
  }

  if (range === "weekly") {
    // This Week View: Show all 7 days
    return Array.from({ length: 7 }, (_, idx) => {
      const stamp = new Date(startDay);
      stamp.setDate(startDay.getDate() + idx);
      const total = scanCounts.get(idx) ?? 0;
      const validated = validatedCounts.get(idx) ?? 0;
      const rate = total > 0 ? (validated / total) * 100 : 0;
      
      return {
        period: WEEKDAY_FORMATTER.format(stamp),
        successRate: parseFloat(rate.toFixed(1)),
        totalScans: total,
        validatedScans: validated,
      };
    });
  }

  // This Month View: Show day numbers
  return Array.from({ length: totalDays }, (_, idx) => {
    const dayNumber = idx + 1;
    const total = scanCounts.get(idx) ?? 0;
    const validated = validatedCounts.get(idx) ?? 0;
    const rate = total > 0 ? (validated / total) * 100 : 0;
    
    return {
      period: dayNumber.toString(),
      successRate: parseFloat(rate.toFixed(1)),
      totalScans: total,
      validatedScans: validated,
    };
  });
}

export default function ReportsPage() {
  const { scans, validationHistory, loading, error, refreshData } = useData();
  const [range, setRange] = useState<Range>("daily");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  
  // Visibility state - prevent chart rendering issues when tab is hidden
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [chartKey, setChartKey] = useState(0);
  
  // Force render state - prevents infinite loading if DataContext loading gets stuck
  const [forceRender, setForceRender] = useState(false);
  
  // Master timeout: force render after 6 seconds to prevent infinite loading
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!forceRender && loading) {
        console.warn('[ReportsPage] Forcing render after timeout');
        setForceRender(true);
      }
    }, 6000);
    return () => clearTimeout(timeout);
  }, [forceRender, loading]);
  
  // Handle visibility changes to prevent chart rendering errors
  useEffect(() => {
    if (typeof document === 'undefined') return;
    
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsPageVisible(visible);
      
      // Force chart re-render when becoming visible
      if (visible) {
        setTimeout(() => {
          setChartKey(prev => prev + 1);
        }, 100);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

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

  const filteredScans = useMemo(() => {
    if (!scans || scans.length === 0) return [];
    
    return scans.filter((scan) => {
      if (!scan.created_at) return false;
      try {
        const createdAt = parseTimestampToLocal(scan.created_at);
        // Ensure valid date
        if (isNaN(createdAt.getTime())) return false;
        // Compare dates properly (rangeStart is start of day, rangeEnd is end of day or current time)
        return createdAt >= rangeStart && createdAt <= rangeEnd;
      } catch {
        return false;
      }
    });
  }, [scans, rangeStart, rangeEnd]);

  // Calculate total scans count from filtered data (not all-time)
  const totalScansCount = useMemo(() => {
    return filteredScans.length;
  }, [filteredScans]);

  const filteredValidations = useMemo(() => {
    if (!validationHistory || validationHistory.length === 0) return [];
    
    return validationHistory.filter((record) => {
      if (!record.validated_at) return false;
      try {
        const validatedAt = parseTimestampToLocal(record.validated_at);
        // Ensure valid date
        if (isNaN(validatedAt.getTime())) return false;
        // Compare dates properly
        return validatedAt >= rangeStart && validatedAt <= rangeEnd;
      } catch {
        return false;
      }
    });
  }, [validationHistory, rangeStart, rangeEnd]);

  const successRate = useMemo(() => {
    // Success Rate = (Validated + Corrected scans) / (Total scans) * 100
    // Shows the percentage of scans that have been successfully processed
    const validatedCount = filteredScans.filter((s) => s.status === "Validated").length;
    const correctedCount = filteredScans.filter((s) => s.status === "Corrected").length;
    const total = filteredScans.length;
    
    if (total === 0) {
      // If no scans in range, return 0
      return 0;
    }
    
    const rate = ((validatedCount + correctedCount) / total) * 100;
    return parseFloat(rate.toFixed(1));
  }, [filteredScans]);

  // Calculate validated scans: Total Scans - Pending
  const validatedScansCount = useMemo(() => {
    const total = filteredScans.length;
    const pending = filteredScans.filter((s) => s.status === "Pending" || s.status === "Pending Validation").length;
    return total - pending;
  }, [filteredScans]);

  const scansTrend = useMemo(() => buildScansTrend(range, filteredScans, rangeStart, rangeEnd), [range, filteredScans, rangeStart, rangeEnd]);

  const successRateTrend = useMemo(() => buildSuccessRateTrend(range, filteredScans, rangeStart, rangeEnd), [range, filteredScans, rangeStart, rangeEnd]);

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
      filteredScans
        .filter((scan) => scan.scan_type === "leaf_disease")
        .forEach((scan) => {
          try {
            const prediction = getAiPrediction(scan);
            if (!prediction) {
              counts.Unknown += 1;
              return;
            }
            const predictionLower = String(prediction).toLowerCase();
            if (predictionLower.includes("cercospora")) counts.Cercospora += 1;
            else if (predictionLower.includes("downy") || predictionLower.includes("mildew")) counts["Downy Mildew"] += 1;
            else if (predictionLower.includes("fusarium") || predictionLower.includes("wilt")) counts["Fusarium Wilt"] += 1;
            else if (predictionLower.includes("mosaic") || predictionLower.includes("virus")) counts["Yellow Mosaic Virus"] += 1;
            else if (predictionLower.includes("healthy")) counts.Healthy += 1;
            else counts.Unknown += 1;
          } catch {
            counts.Unknown += 1;
          }
        });
    }

    // Return in specific order with all items (even if 0) - order: Cercospora, Yellow Mosaic Virus, Healthy, Unknown, Fusarium Wilt, Downy Mildew
    const order = ["Cercospora", "Yellow Mosaic Virus", "Healthy", "Unknown", "Fusarium Wilt", "Downy Mildew"];
    return order.map((name) => ({
      name,
      value: counts[name as keyof typeof counts] || 0,
    }));
  }, [filteredScans]);

  const ripenessDistribution = useMemo(() => {
    const counts = {
      Unknown: 0,
      Immature: 0,
      Mature: 0,
      Overmature: 0,
      Overripe: 0,
    };
    
    if (filteredScans && filteredScans.length > 0) {
      filteredScans
        .filter((scan) => scan.scan_type === "fruit_maturity")
        .forEach((scan) => {
          try {
            const prediction = getAiPrediction(scan);
            if (!prediction) {
              counts.Unknown += 1;
              return;
            }
            const predictionLower = String(prediction).toLowerCase();
            if (predictionLower.includes("immature")) counts.Immature += 1;
            else if (predictionLower.includes("mature") && !predictionLower.includes("over")) counts.Mature += 1;
            else if (predictionLower.includes("overmature")) counts.Overmature += 1;
            else if (predictionLower.includes("overripe")) counts.Overripe += 1;
            else counts.Unknown += 1;
          } catch {
            counts.Unknown += 1;
          }
        });
    }

    // Return in specific order with all items (even if 0) - order: Unknown, Immature, Mature, Overmature, Overripe
    const order = ["Unknown", "Immature", "Mature", "Overmature", "Overripe"];
    return order.map((name) => ({
      name,
      value: counts[name as keyof typeof counts] || 0,
    }));
  }, [filteredScans]);

  // CSV Export function - Professional and comprehensive
  const generateCSV = useCallback(() => {
    const formatDate = (date: Date) => date.toLocaleDateString("en-US", { 
      month: "short", 
      day: "numeric", 
      year: "numeric" 
    });
    
    const formatTime = (date: Date) => date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });

    const startDateStr = formatDate(rangeStart);
    const endDateStr = formatDate(rangeEnd);
    const generatedAt = `${formatDate(new Date())} ${formatTime(new Date())}`;

    // Collect disease counts
    const diseaseCounts = diseaseDistribution.reduce((acc, item) => {
      acc[item.name] = item.value;
      return acc;
    }, {} as Record<string, number>);

    // Collect ripeness counts
    const ripenessCounts = ripenessDistribution.reduce((acc, item) => {
      acc[item.name] = item.value;
      return acc;
    }, {} as Record<string, number>);

    // Calculate pending scans
    const pendingScans = filteredScans.filter(
      (s) => s.status === "Pending" || s.status === "Pending Validation"
    ).length;

    // Build CSV sections
    const sections: string[] = [];
    
    // === HEADER SECTION ===
    sections.push("BITTERSCAN - DISEASE DETECTION REPORT");
    sections.push(`Report Period:,${dateRangeLabel}`);
    sections.push(`Start Date:,${startDateStr}`);
    sections.push(`End Date:,${endDateStr}`);
    sections.push(`Generated On:,${generatedAt}`);
    sections.push(""); // Empty line

    // === SUMMARY METRICS ===
    sections.push("SUMMARY METRICS");
    sections.push("Metric,Value");
    sections.push(`Total Scans,${filteredScans.length.toLocaleString()}`);
    sections.push(`Total Validated,${validatedScansCount.toLocaleString()}`);
    sections.push(`Pending Validation,${pendingScans.toLocaleString()}`);
    sections.push(`Success Rate,%${successRate.toFixed(2)}`);
    sections.push(""); // Empty line

    // === HOURLY SCAN BREAKDOWN (Daily only) ===
    if (range === "daily") {
      sections.push("HOURLY SCAN BREAKDOWN");
      sections.push("Hour,Total Scans,Validated,Corrected,Pending,Success Rate (%)");
      
      const hourlyCounts = new Map<number, { total: number; validated: number; corrected: number; pending: number }>();
      
      // Count scans by hour
      filteredScans.forEach((scan) => {
        try {
          const createdAt = parseTimestampToLocal(scan.created_at);
          const hour = createdAt.getHours();
          const bucket = hourlyCounts.get(hour) || { total: 0, validated: 0, corrected: 0, pending: 0 };
          bucket.total += 1;
          if (scan.status === "Validated") bucket.validated += 1;
          else if (scan.status === "Corrected") bucket.corrected += 1;
          else if (scan.status === "Pending" || scan.status === "Pending Validation") bucket.pending += 1;
          hourlyCounts.set(hour, bucket);
        } catch {}
      });

      // Output all 24 hours
      for (let hour = 0; hour < 24; hour++) {
        const bucket = hourlyCounts.get(hour) || { total: 0, validated: 0, corrected: 0, pending: 0 };
        const hourStr = hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
        const hourSuccessRate = bucket.total > 0 ? ((bucket.validated + bucket.corrected) / bucket.total * 100).toFixed(2) : "0.00";
        sections.push(`${hourStr},${bucket.total},${bucket.validated},${bucket.corrected},${bucket.pending},${hourSuccessRate}%`);
      }
      sections.push(""); // Empty line
    }

    // === LEAF DISEASE DISTRIBUTION ===
    sections.push("LEAF DISEASE DISTRIBUTION");
    sections.push("Disease Type,Count,Percentage");
    const totalLeafScans = filteredScans.filter((s) => s.scan_type === "leaf_disease").length;
    
    if (totalLeafScans > 0) {
      const diseaseOrder = ["Healthy", "Cercospora", "Yellow Mosaic Virus", "Downy Mildew", "Fusarium Wilt", "Unknown"];
      diseaseOrder.forEach((disease) => {
        const count = diseaseCounts[disease] || 0;
        const percentage = ((count / totalLeafScans) * 100).toFixed(2);
        sections.push(`${disease},${count},${percentage}%`);
      });
    } else {
      sections.push("No Data,0,0.00%");
    }
    sections.push(""); // Empty line

    // === FRUIT RIPENESS DISTRIBUTION ===
    sections.push("FRUIT RIPENESS DISTRIBUTION");
    sections.push("Ripeness Stage,Count,Percentage");
    const totalFruitScans = filteredScans.filter((s) => s.scan_type === "fruit_maturity").length;
    
    if (totalFruitScans > 0) {
      const ripenessOrder = ["Immature", "Mature", "Overmature", "Overripe", "Unknown"];
      ripenessOrder.forEach((stage) => {
        const count = ripenessCounts[stage] || 0;
        const percentage = ((count / totalFruitScans) * 100).toFixed(2);
        sections.push(`${stage},${count},${percentage}%`);
      });
    } else {
      sections.push("No Data,0,0.00%");
    }
    sections.push(""); // Empty line

    // === SCAN TYPE BREAKDOWN ===
    sections.push("SCAN TYPE BREAKDOWN");
    sections.push("Scan Type,Count,Percentage");
    const leafCount = filteredScans.filter((s) => s.scan_type === "leaf_disease").length;
    const fruitCount = filteredScans.filter((s) => s.scan_type === "fruit_maturity").length;
    const total = filteredScans.length;
    
    if (total > 0) {
      sections.push(`Leaf Disease,${leafCount},${((leafCount / total) * 100).toFixed(2)}%`);
      sections.push(`Fruit Ripeness,${fruitCount},${((fruitCount / total) * 100).toFixed(2)}%`);
    } else {
      sections.push("No Data,0,0.00%");
    }
    sections.push(""); // Empty line

    // === VALIDATION STATUS BREAKDOWN ===
    sections.push("VALIDATION STATUS BREAKDOWN");
    sections.push("Status,Count,Percentage");
    const statusCounts = {
      Validated: filteredScans.filter((s) => s.status === "Validated").length,
      Corrected: filteredScans.filter((s) => s.status === "Corrected").length,
      Pending: pendingScans,
    };
    
    if (total > 0) {
      Object.entries(statusCounts).forEach(([status, count]) => {
        const percentage = ((count / total) * 100).toFixed(2);
        sections.push(`${status},${count},${percentage}%`);
      });
    } else {
      sections.push("No Data,0,0.00%");
    }
    
    // Add BOM for UTF-8 to ensure proper Excel compatibility
    const BOM = '\uFEFF';
    return BOM + sections.join("\n");
  }, [
    range,
    dateRangeLabel,
    rangeStart,
    rangeEnd,
    filteredScans,
    validatedScansCount,
    successRate,
    diseaseDistribution,
    ripenessDistribution
  ]);

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
      toast.error("Please allow pop-ups to generate PDF");
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
                <div class="metric-label">Success Rate</div>
                <div class="metric-value">${successRate.toFixed(1)}%</div>
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
  }, [range, dateRangeLabel, rangeStart, rangeEnd, filteredScans, validatedScansCount, successRate, diseaseDistribution, ripenessDistribution, scansTrend]);

  // Show loading state only if not force-rendered and loading is true
  // forceRender bypasses the loading check to prevent infinite loading
  if (loading && !forceRender) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="flex items-center justify-center min-h-[70vh]">
            <div className="text-center space-y-4">
              <Loader2 className="h-14 w-14 animate-spin text-[#388E3C] mx-auto" />
              <div>
                <p className="text-lg font-medium text-gray-900">Loading Reports</p>
                <p className="text-sm text-gray-500 mt-1">Fetching analytics data...</p>
              </div>
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
          <div className="flex items-center justify-center min-h-[70vh]">
            <div className="text-center space-y-4 max-w-md">
              <div className="bg-red-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-500" />
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-900 mb-2">Unable to Load Reports</p>
                <p className="text-sm text-gray-600 mb-4">{error}</p>
              </div>
              <Button 
                variant="outline" 
                onClick={() => refreshData(true)}
                className="hover:bg-gray-50"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Retry
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
          <div className="space-y-3">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Reports &amp; Analytics</h1>
              <p className="text-gray-600 text-sm">Comprehensive insights into scan activity and AI performance</p>
            </div>
            
            {/* Real-time Clock */}
            <div className="flex items-center justify-between px-5 py-3 text-sm bg-gradient-to-r from-[#388E3C] to-[#2F7A33] rounded-lg shadow-md">
              <RealTimeClock />
            </div>
          </div>

          {/* Filters Section */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6">
            {/* Date Range Filter Section - Left Side */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Time Period:
              </span>
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
            
            {/* Export Buttons - Right Side */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const csvContent = generateCSV();
                  downloadCSV(csvContent);
                }}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <Button
                size="sm"
                onClick={() => generatePDF()}
                className="flex items-center gap-2 text-white bg-[#388E3C] border-[#388E3C] hover:bg-[#2F7A33] hover:border-[#2F7A33] transition-colors"
              >
                <Download className="h-4 w-4" />
                Export PDF
              </Button>
            </div>
          </div>

          {/* KPI Cards Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-4">
            {[
              {
                icon: Camera,
                label: "Total Scans",
                value: totalScansCount.toLocaleString("en-US"),
                tone: "text-blue-600",
              },
              {
                icon: CheckCircle2,
                label: "Total Validated",
                value: validatedScansCount.toLocaleString("en-US"),
                tone: "text-green-600",
              },
              {
                icon: TrendingUp,
                label: "Success Rate",
                value: `${successRate}%`,
                tone: "text-purple-600",
              },
            ].map((metric, idx) => {
              const Icon = metric.icon;
              return (
                <Card key={idx} className="shadow-sm hover:shadow-md transition-all duration-200">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-700">{metric.label}</span>
                      <Icon className={`h-4 w-4 ${metric.tone}`} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <p className="text-2xl font-bold text-gray-900">{metric.value}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Scans Trend Chart - Full Width */}
          <Card className="shadow-lg border border-[#388E3C]/20 rounded-xl overflow-hidden">
            <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] px-6 pt-5">
              <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>Scans Trend • {dateRangeLabel}</CardTitle>
              <p className="text-sm text-gray-100 mt-1" style={{ color: 'white' }}>Scan activity patterns over time</p>
            </CardHeader>
            <CardContent className="pt-6 pb-4">
            {scansTrend.length > 0 && isPageVisible ? (
              <div style={{ minHeight: 320 }}>
                <ResponsiveContainer key={`scans-trend-${chartKey}`} width="100%" height={320}>
                  <LineChart data={scansTrend} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="period" 
                    stroke="#6b7280" 
                    fontSize={12} 
                    tick={{ fill: "#6b7280" }}
                    tickLine={false}
                    interval={range === "monthly" ? Math.floor(scansTrend.length / 15) : "preserveStartEnd"}
                    angle={range === "monthly" ? 0 : 0}
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
                      borderRadius: "8px",
                      fontSize: "13px",
                      padding: "8px 12px",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                    }}
                    formatter={(value: number | undefined) => [value ?? 0, "Scans"]}
                    labelFormatter={(label) => {
                      if (range === "daily") return `Hour: ${label}`;
                      if (range === "weekly") return label;
                      return `Day ${label}`;
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ fontSize: "12px", paddingTop: "15px" }}
                    iconType="circle"
                  />
                  <Line
                    type="monotone"
                    dataKey="scans"
                    stroke="#388E3C"
                    strokeWidth={3}
                    name="Total Scans"
                    dot={range === "monthly" ? false : { fill: "#388E3C", r: 4, strokeWidth: 2, stroke: "#fff" }}
                    activeDot={{ r: 7, strokeWidth: 2, stroke: "#fff" }}
                    animationDuration={1000}
                  />
                </LineChart>
              </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[320px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-6 text-center">
                <div className="text-gray-400 mb-3">
                  <TrendingUp className="w-12 h-12 mx-auto" />
                </div>
                <p className="text-gray-700 font-medium">No scan data available</p>
                <p className="mt-1 text-xs text-gray-500">Data for {dateRangeLabel.toLowerCase()} will appear here once scans are recorded</p>
              </div>
            )}
            </CardContent>
          </Card>

          {/* Disease and Ripeness Distribution Sections - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Disease Distribution Section */}
            <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 rounded-xl overflow-hidden">
              <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
                <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                  Disease Distribution
                </CardTitle>
                <p className="text-sm text-white/90 mt-1" style={{ color: 'white' }}>Leaf disease scan analysis for {dateRangeLabel.toLowerCase()}</p>
              </CardHeader>
              <CardContent className="pt-6 pb-4">
                <div className="space-y-6">
                  <div className="flex justify-center" style={{ minHeight: 280 }}>
                    {diseaseDistribution.some((item) => item.value > 0) && isPageVisible ? (
                      <ResponsiveContainer key={`disease-dist-${chartKey}`} width="100%" height={280}>
                        <RechartsPieChart>
                          <Pie
                            data={diseaseDistribution.filter((item) => item.value > 0)}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={90}
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
                            formatter={(value: number | undefined, name: string | undefined) => [
                              `${(value ?? 0).toLocaleString("en-US")} cases`,
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
                  
                  {/* Indicators/Labels - Show all categories */}
                  <div className="space-y-2 pt-4 border-t border-gray-200">
                    {diseaseDistribution.map((entry) => {
                      const total = diseaseDistribution.reduce((sum, item) => sum + item.value, 0);
                      const percentage = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0.0";
                      const color = DISEASE_COLORS[entry.name] || "#6B7280";
                      
                      return (
                        <motion.div
                          key={entry.name}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3 }}
                          className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                            entry.value === 0 
                              ? "bg-gray-50/50 opacity-60" 
                              : "bg-gray-50 hover:bg-gray-100"
                          }`}
                        >
                          <div 
                            className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <div className="flex-1 min-w-0 flex items-center justify-between">
                            <p className={`text-sm font-semibold truncate ${
                              entry.value === 0 ? "text-gray-500" : "text-gray-900"
                            }`}>
                              {entry.name}
                            </p>
                            <div className="flex items-baseline gap-2 ml-2">
                              <span className={`text-base font-bold ${
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
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Ripeness Distribution Section */}
            <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 rounded-xl overflow-hidden">
              <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
                <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                  Ripeness Distribution
                </CardTitle>
                <p className="text-sm text-white/90 mt-1" style={{ color: 'white' }}>Fruit maturity scan analysis for {dateRangeLabel.toLowerCase()}</p>
              </CardHeader>
              <CardContent className="pt-6 pb-4">
                <div className="space-y-6">
                  <div className="flex justify-center" style={{ minHeight: 280 }}>
                    {ripenessDistribution.some((item) => item.value > 0) && isPageVisible ? (
                      <ResponsiveContainer key={`ripeness-dist-${chartKey}`} width="100%" height={280}>
                        <RechartsPieChart>
                          <Pie
                            data={ripenessDistribution.filter((item) => item.value > 0)}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={90}
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
                            formatter={(value: number | undefined, name: string | undefined) => [
                              `${(value ?? 0).toLocaleString("en-US")} items`,
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
                  
                  {/* Indicators/Labels - Show all categories */}
                  <div className="space-y-2 pt-4 border-t border-gray-200">
                    {ripenessDistribution.map((entry) => {
                      const total = ripenessDistribution.reduce((sum, item) => sum + item.value, 0);
                      const percentage = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0.0";
                      const color = RIPENESS_COLORS[entry.name] || "#6B7280";
                      
                      return (
                        <motion.div
                          key={entry.name}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3 }}
                          className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                            entry.value === 0 
                              ? "bg-gray-50/50 opacity-60" 
                              : "bg-gray-50 hover:bg-gray-100"
                          }`}
                        >
                          <div 
                            className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <div className="flex-1 min-w-0 flex items-center justify-between">
                            <p className={`text-sm font-semibold truncate ${
                              entry.value === 0 ? "text-gray-500" : "text-gray-900"
                            }`}>
                              {entry.name}
                            </p>
                            <div className="flex items-baseline gap-2 ml-2">
                              <span className={`text-base font-bold ${
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
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Success Rate Trend Section */}
          <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 rounded-xl overflow-hidden">
            <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] px-6 pt-5">
              <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                Success Rate Trend • {dateRangeLabel}
              </CardTitle>
              <p className="text-sm mt-1 text-gray-100" style={{ color: 'white' }}>
                {range === "daily" && "Hourly validation success rate for today"}
                {range === "weekly" && "Daily validation success rate for this week"}
                {range === "monthly" && "Daily validation success rate for this month"}
                {range === "custom" && "Validation success rate for selected period"}
              </p>
            </CardHeader>
            <CardContent className="pt-6">
              <div style={{ minHeight: 350 }}>
              {successRateTrend.length > 0 && isPageVisible ? (
                <ResponsiveContainer key={`success-rate-${chartKey}`} width="100%" height={350}>
                  <LineChart data={successRateTrend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="period" 
                      stroke="#6b7280" 
                      fontSize={12} 
                      tick={{ fill: "#6b7280" }}
                      tickLine={false}
                      interval={range === "monthly" ? Math.floor(successRateTrend.length / 15) : "preserveStartEnd"}
                    />
                    <YAxis 
                      stroke="#6b7280" 
                      fontSize={12} 
                      tick={{ fill: "#6b7280" }}
                      allowDecimals={false}
                      tickLine={false}
                      domain={[0, 100]}
                      label={{ value: 'Success Rate (%)', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#6b7280' } }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        fontSize: "13px",
                        padding: "10px 14px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      }}
                      formatter={(value: number | undefined, name: string | undefined) => {
                        const val = value ?? 0; if (name === "Success Rate") return [`${val}%`, "Success Rate"];
                        return [val, name];
                      }}
                      labelFormatter={(label) => {
                        if (range === "daily") return `Hour: ${label}`;
                        if (range === "weekly") return label;
                        return `Day ${label}`;
                      }}
                    />
                    <Legend 
                      wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }}
                      iconType="circle"
                    />
                    <Line
                      type="monotone"
                      dataKey="successRate"
                      stroke="#388E3C"
                      strokeWidth={3}
                      name="Success Rate"
                      dot={range === "monthly" ? false : { fill: "#388E3C", r: 5, strokeWidth: 2, stroke: "#fff" }}
                      activeDot={{ r: 7, strokeWidth: 2, stroke: "#fff" }}
                      animationDuration={1000}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[350px] items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-6 text-center">
                  <div className="text-gray-400 mb-3">
                    <TrendingUp className="w-12 h-12 mx-auto mb-3" />
                  </div>
                  <div>
                    <p className="text-gray-700 font-medium">No success rate data available</p>
                    <p className="mt-1 text-xs text-gray-500">Data for {dateRangeLabel.toLowerCase()} will appear here once scans are validated</p>
                  </div>
                </div>
              )}
              </div>
            </CardContent>
          </Card>

          {/* Monthly Performance Details Table */}
          <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 rounded-xl overflow-hidden">
            <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] px-6 pt-5">
              <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                Performance Details • {dateRangeLabel}
              </CardTitle>
              <p className="text-sm mt-1 text-gray-100" style={{ color: 'white' }}>
                {range === "daily" && "Hourly breakdown of validation metrics for today"}
                {range === "weekly" && "Daily breakdown of validation metrics for this week"}
                {range === "monthly" && "Daily breakdown of validation metrics for this month"}
                {range === "custom" && "Breakdown of validation metrics for selected period"}
              </p>
            </CardHeader>
            <CardContent className="pt-6">
              {(() => {
                // Build performance details based on selected time range
                const performanceDetails = [];

                if (range === "daily") {
                  // Today: Show hourly breakdown
                  const base = normalizeToStartOfDayUTC(rangeStart);
                  
                  for (let hour = 0; hour < 24; hour++) {
                    // Create hour boundaries in Asia/Manila timezone
                    // base is already in UTC representing midnight Manila
                    // Add hours in UTC to maintain Manila timezone alignment
                    const hourStart = new Date(base.getTime() + (hour * 60 * 60 * 1000));
                    const hourEnd = new Date(base.getTime() + ((hour + 1) * 60 * 60 * 1000) - 1);
                    
                    const hourScans = filteredScans.filter(scan => {
                      if (!scan.created_at) return false;
                      const scanDate = new Date(scan.created_at);
                      const scanHour = scanDate.getUTCHours();
                      return scanHour === hour;
                    });
                    
                    const totalScans = hourScans.length;
                    const validatedScans = hourScans.filter(s => s.status === "Validated").length;
                    const correctedScans = hourScans.filter(s => s.status === "Corrected").length;
                    const pendingScans = hourScans.filter(s => s.status === "Pending" || s.status === "Pending Validation").length;
                    const successRate = totalScans > 0 ? ((validatedScans + correctedScans) / totalScans) * 100 : 0;
                    
                    // Format the hour label using Philippine timezone
                    const hourLabel = HOUR_FORMATTER.format(hourStart);
                    
                    performanceDetails.push({
                      period: hourLabel,
                      totalScans,
                      validatedScans,
                      correctedScans,
                      pendingScans,
                      successRate: parseFloat(successRate.toFixed(1))
                    });
                  }
                } else {
                  // Weekly or Monthly: Show daily breakdown
                  const startDay = normalizeToStartOfDayUTC(rangeStart);
                  const endDay = normalizeToStartOfDayUTC(rangeEnd);
                  const totalDays = Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / ONE_DAY) + 1);
                  
                  const daysToShow = range === "weekly" ? 7 : totalDays;
                  
                  for (let dayIdx = 0; dayIdx < daysToShow; dayIdx++) {
                    const dayStart = new Date(startDay);
                    dayStart.setDate(startDay.getDate() + dayIdx);
                    dayStart.setHours(0, 0, 0, 0);
                    
                    const dayEnd = new Date(dayStart);
                    dayEnd.setHours(23, 59, 59, 999);
                    
                    const dayScans = filteredScans.filter(scan => {
                      if (!scan.created_at) return false;
                      const scanDate = parseTimestampToLocal(scan.created_at);
                      return scanDate >= dayStart && scanDate <= dayEnd;
                    });
                    
                    const totalScans = dayScans.length;
                    const validatedScans = dayScans.filter(s => s.status === "Validated").length;
                    const correctedScans = dayScans.filter(s => s.status === "Corrected").length;
                    const pendingScans = dayScans.filter(s => s.status === "Pending" || s.status === "Pending Validation").length;
                    const successRate = totalScans > 0 ? ((validatedScans + correctedScans) / totalScans) * 100 : 0;
                    
                    let periodLabel;
                    if (range === "weekly") {
                      periodLabel = WEEKDAY_FORMATTER.format(dayStart);
                    } else {
                      periodLabel = `Day ${dayIdx + 1}`;
                    }
                    
                    performanceDetails.push({
                      period: periodLabel,
                      totalScans,
                      validatedScans,
                      correctedScans,
                      pendingScans,
                      successRate: parseFloat(successRate.toFixed(1))
                    });
                  }
                }

                // Filter out rows with no activity (optional - can keep all rows)
                const hasAnyData = performanceDetails.some(d => d.totalScans > 0);

                return hasAnyData ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b-2 border-[#388E3C]/20">
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                            {range === "daily" ? "Hour" : range === "weekly" ? "Day" : "Day"}
                          </th>
                          <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Total Scans</th>
                          <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Validated</th>
                          <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Corrected</th>
                          <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Pending</th>
                          <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Success Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {performanceDetails.map((detail, index) => {
                          const hasActivity = detail.totalScans > 0;
                          return (
                            <motion.tr
                              key={detail.period}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3, delay: index * 0.02 }}
                              className={`border-b border-gray-200 transition-colors ${
                                hasActivity ? "hover:bg-gray-50" : "opacity-50"
                              }`}
                            >
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">{detail.period}</td>
                              <td className="px-4 py-3 text-center text-sm font-semibold text-blue-600">
                                {detail.totalScans}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {detail.validatedScans > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {detail.validatedScans}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-400">0</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {detail.correctedScans > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">
                                    {detail.correctedScans}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-400">0</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {detail.pendingScans > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-sm font-medium">
                                    <Clock className="w-3.5 h-3.5" />
                                    {detail.pendingScans}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-400">0</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center gap-2 justify-center">
                                  <span className="text-sm font-semibold text-gray-900">
                                    {detail.successRate}%
                                  </span>
                                  <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-[#388E3C] to-[#2F7A33] transition-all duration-300"
                                      style={{ width: `${Math.min(detail.successRate, 100)}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                            </motion.tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex h-[200px] items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                    <div className="text-center">
                      <AlertCircle className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm font-medium text-gray-600">No performance data available</p>
                      <p className="text-xs text-gray-500 mt-1">Data for {dateRangeLabel.toLowerCase()} will appear here once scans are recorded</p>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

