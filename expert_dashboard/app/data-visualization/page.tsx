"use client";

import { useMemo, Suspense, useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { supabase } from "@/components/supabase";
import type { Scan, ValidationHistory } from "@/types";
import { getAiPrediction, isLeafDiseaseScan, isFruitRipenessScan } from "@/types";
import { Loader2, TrendingUp, Camera, CheckCircle2, AlertCircle, Calendar, Clock3, BarChart3, MapPin, Filter, X } from "lucide-react";
import toast from "react-hot-toast";

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

// Dynamically import map component to avoid SSR issues
const InteractiveFarmMap = dynamic(
  () => import("@/components/InteractiveFarmMap"),
  { 
    ssr: false,
    loading: () => (
      <Card className="shadow-lg border border-[#388E3C]/20">
        <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
          <CardTitle className="text-xl font-bold">Farm Disease Map</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 pb-4">
          <div className="flex h-[500px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#388E3C]" />
          </div>
        </CardContent>
      </Card>
    )
  }
);

// Recharts Tooltip payload entry type
type TooltipPayloadEntry = {
  name: string;
  value: number;
  payload?: AppPerformanceDatum | MonthlyMostScannedDatum;
  color?: string;
  dataKey?: string;
};

type AppPerformanceDatum = {
  month: string;
  successRate: number;
  totalScans: number;
  validatedScans: number;
  avgConfidence: number;
  aiAccuracyRate: number;
};

type MonthlyMostScannedDatum = {
  month: string;
  // Leaf Disease Group - Individual counts
  'Disease_Cercospora'?: number;
  'Disease_Yellow Mosaic Virus'?: number;
  'Disease_Downy Mildew'?: number;
  'Disease_Fusarium Wilt'?: number;
  'Disease_Healthy'?: number;
  // Fruit Ripeness Group - Individual counts
  'Ripeness_Immature'?: number;
  'Ripeness_Mature'?: number;
  'Ripeness_Overmature'?: number;
  'Ripeness_Overripe'?: number;
  // Totals for reference
  totalDiseaseCount: number;
  totalRipenessCount: number;
  totalCount: number;
};

type ExpertValidationDatum = {
  month: string;
  aiValidated: number;
  aiCorrected: number;
  mismatchRate: number;
  totalValidations: number;
};

// Disease color mapping - Consistent across all pages
const DISEASE_COLORS: Record<string, string> = {
  "Healthy": "#22C55E", // Bright Green - ALWAYS GREEN
  "Cercospora": "#EF4444", // Red
  "Yellow Mosaic Virus": "#F59E0B", // Amber/Orange
  "Downy Mildew": "#3B82F6", // Blue
  "Fusarium Wilt": "#8B5CF6", // Purple
  "Unknown": "#6B7280", // Gray
};

// Ripeness color mapping - Consistent across all pages
const RIPENESS_COLORS: Record<string, string> = {
  "Immature": "#3B82F6", // Blue
  "Mature": "#22C55E", // Green
  "Overmature": "#F59E0B", // Amber
  "Overripe": "#EF4444", // Red
  "Unknown": "#6B7280", // Gray
};

// Build 12-month app performance data
function buildAppPerformance(scans: Scan[], validationHistory: ValidationHistory[]): AppPerformanceDatum[] {
  const now = new Date();
  const months: AppPerformanceDatum[] = [];

  for (let i = 11; i >= 0; i--) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });

    const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));

    const monthScans = scans.filter((scan) => {
      if (!scan?.created_at) return false;
      try {
        const scanDate = new Date(scan.created_at);
        if (isNaN(scanDate.getTime())) return false;
        const scanDateStr = scanDate.toISOString().split("T")[0];
        const monthStartStr = monthStart.toISOString().split("T")[0];
        const monthEndStr = monthEnd.toISOString().split("T")[0];
        return scanDateStr >= monthStartStr && scanDateStr <= monthEndStr;
      } catch {
        return false;
      }
    });

    const totalScans = monthScans.length;
    const validatedScans = monthScans.filter((scan) => scan.status !== "Pending Validation").length;
    const successRate = totalScans > 0 ? (validatedScans / totalScans) * 100 : 0;

    const monthValidations = validationHistory.filter((vh) => {
      if (!vh?.validated_at) return false;
      try {
        const validationDate = new Date(vh.validated_at);
        if (isNaN(validationDate.getTime())) return false;
        const validationDateStr = validationDate.toISOString().split("T")[0];
        const monthStartStr = monthStart.toISOString().split("T")[0];
        const monthEndStr = monthEnd.toISOString().split("T")[0];
        return validationDateStr >= monthStartStr && validationDateStr <= monthEndStr;
      } catch {
        return false;
      }
    });

    const validatedCount = monthValidations.filter((vh) => vh.status === "Validated").length;
    const correctedCount = monthValidations.filter((vh) => vh.status === "Corrected").length;
    const totalValidatedOrCorrected = validatedCount + correctedCount;
    const aiAccuracyRate = totalValidatedOrCorrected > 0 ? (validatedCount / totalValidatedOrCorrected) * 100 : 0;

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
      totalScans,
      validatedScans,
      successRate: parseFloat(successRate.toFixed(1)),
      aiAccuracyRate: parseFloat(aiAccuracyRate.toFixed(1)),
      avgConfidence: parseFloat(avgConfidence.toFixed(1)),
    });
  }

  return months;
}

// Build 12-month most scanned categories data
function buildMonthlyMostScanned(scans: Scan[]): MonthlyMostScannedDatum[] {
  const now = new Date();
  const months: MonthlyMostScannedDatum[] = [];

  for (let i = 11; i >= 0; i--) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });

    const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));

    const monthScans = scans.filter((scan) => {
      if (!scan?.created_at) return false;
      try {
        const scanDate = new Date(scan.created_at);
        if (isNaN(scanDate.getTime())) return false;
        const scanDateStr = scanDate.toISOString().split("T")[0];
        const monthStartStr = monthStart.toISOString().split("T")[0];
        const monthEndStr = monthEnd.toISOString().split("T")[0];
        return scanDateStr >= monthStartStr && scanDateStr <= monthEndStr;
      } catch {
        return false;
      }
    });

    const diseaseScans = monthScans.filter(s => isLeafDiseaseScan(s));
    const ripenessScans = monthScans.filter(s => isFruitRipenessScan(s));

    // Count all disease types
    const diseaseMap = new Map<string, number>();
    for (const scan of diseaseScans) {
      const prediction = getAiPrediction(scan);
      if (prediction && prediction !== 'Unknown') {
        diseaseMap.set(prediction, (diseaseMap.get(prediction) || 0) + 1);
      }
    }

    // Count all ripeness types
    const ripenessMap = new Map<string, number>();
    for (const scan of ripenessScans) {
      const prediction = getAiPrediction(scan);
      if (prediction && prediction !== 'Unknown') {
        ripenessMap.set(prediction, (ripenessMap.get(prediction) || 0) + 1);
      }
    }

    // Build month data with prefixed categories for grouping
    const monthData: MonthlyMostScannedDatum = {
      month: monthName,
      // Disease categories (prefixed for grouping)
      'Disease_Cercospora': diseaseMap.get('Cercospora') || 0,
      'Disease_Yellow Mosaic Virus': diseaseMap.get('Yellow Mosaic Virus') || 0,
      'Disease_Downy Mildew': diseaseMap.get('Downy Mildew') || 0,
      'Disease_Fusarium Wilt': diseaseMap.get('Fusarium Wilt') || 0,
      'Disease_Healthy': diseaseMap.get('Healthy') || 0,
      // Ripeness categories (prefixed for grouping)
      'Ripeness_Immature': ripenessMap.get('Immature') || 0,
      'Ripeness_Mature': ripenessMap.get('Mature') || 0,
      'Ripeness_Overmature': ripenessMap.get('Overmature') || 0,
      'Ripeness_Overripe': ripenessMap.get('Overripe') || 0,
      // Totals
      totalDiseaseCount: diseaseScans.length,
      totalRipenessCount: ripenessScans.length,
      totalCount: diseaseScans.length + ripenessScans.length,
    };

    months.push(monthData);
  }

  return months;
}

// Build expert validation performance data for 12 months
function buildExpertValidationPerformance(validationHistory: ValidationHistory[]): ExpertValidationDatum[] {
  const now = new Date();
  const months: ExpertValidationDatum[] = [];

  for (let i = 11; i >= 0; i--) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthName = monthDate.toLocaleDateString("en-US", { month: "short" });

    const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));

    const monthValidations = validationHistory.filter((vh) => {
      if (!vh?.validated_at) return false;
      try {
        const validationDate = new Date(vh.validated_at);
        if (isNaN(validationDate.getTime())) return false;
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
    const mismatchRate = totalValidations > 0 ? (aiCorrected / totalValidations) * 100 : 0;

    months.push({
      month: monthName,
      aiValidated,
      aiCorrected,
      totalValidations,
      mismatchRate: parseFloat(mismatchRate.toFixed(1)),
    });
  }

  return months;
}

// Date range helper functions
const getRangeStart = (range: string, customStart?: Date): Date => {
  const now = new Date();
  const start = customStart || new Date();
  
  switch (range) {
    case "today":
      start.setUTCHours(0, 0, 0, 0);
      return start;
    case "this_week":
      const currentDay = now.getUTCDay();
      const diff = currentDay === 0 ? 6 : currentDay - 1;
      start.setUTCDate(now.getUTCDate() - diff);
      start.setUTCHours(0, 0, 0, 0);
      return start;
    case "this_month":
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      return start;
    case "custom":
      if (customStart) {
        customStart.setUTCHours(0, 0, 0, 0);
        return customStart;
      }
      start.setUTCHours(0, 0, 0, 0);
      return start;
    default:
      start.setUTCHours(0, 0, 0, 0);
      return start;
  }
};

const getRangeEnd = (range: string, customEnd?: Date): Date => {
  const now = new Date();
  const end = customEnd || new Date();
  
  switch (range) {
    case "today":
      end.setUTCHours(23, 59, 59, 999);
      return end;
    case "this_week":
    case "this_month":
      return now;
    case "custom":
      if (customEnd) {
        customEnd.setUTCHours(23, 59, 59, 999);
        return customEnd;
      }
      end.setUTCHours(23, 59, 59, 999);
      return end;
    default:
      return now;
  }
};

const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
];

const RANGE_LABELS: Record<string, string> = {
  today: "Today",
  this_week: "This Week",
  this_month: "This Month",
  custom: "Custom Range",
};

export default function DataVisualizationPage() {
  const router = useRouter();
  const dataContext = useData();
  
  // Date filter state
  const [range, setRange] = useState<string>("today");
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  
  // Map filter state
  const [scanTypeFilter, setScanTypeFilter] = useState<"all" | "leaf_disease" | "fruit_maturity">("all");
  const [diseaseFilter, setDiseaseFilter] = useState<string>("all");
  const [farmFilter, setFarmFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  
  // Detection Records state
  const [recordsSearchQuery, setRecordsSearchQuery] = useState<string>("");
  const [recordsCurrentPage, setRecordsCurrentPage] = useState<number>(1);
  const recordsPerPage = 10;
  
  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [scanToDelete, setScanToDelete] = useState<Scan | null>(null);
  
  // Farms data state
  const [farmsData, setFarmsData] = useState<any[]>([]);
  const [farmsLoading, setFarmsLoading] = useState(true);
  const [farmerProfiles, setFarmerProfiles] = useState<Map<string, any>>(new Map());
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Visibility state - prevent chart rendering issues when tab is hidden
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [chartKey, setChartKey] = useState(0);
  
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
  
  // Delete handler function - Opens confirmation modal
  const handleDeleteScan = async (scan: Scan) => {
    setScanToDelete(scan);
    setShowDeleteModal(true);
  };
  
  // Confirm delete function - Actually deletes the scan
  const confirmDeleteScan = async () => {
    if (!scanToDelete) return;
    
    const scanTypeLabel = scanToDelete.scan_type === 'leaf_disease' ? 'leaf disease' : 'fruit ripeness';
    
    setIsDeleting(true);
    try {
      const tableName = scanToDelete.scan_type === 'leaf_disease' ? 'leaf_disease_scans' : 'fruit_ripeness_scans';
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', scanToDelete.id);
      
      if (error) {
        console.error('Error deleting scan:', error);
        toast.error('Failed to delete scan. Please try again.');
      } else {
        toast.success('Scan deleted successfully');
        // Refresh data context to update UI
        if (dataContext?.refreshData) {
          await dataContext.refreshData();
        } else {
          window.location.reload();
        }
      }
    } catch (error) {
      console.error('Error deleting scan:', error);
      toast.error('An unexpected error occurred.');
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setScanToDelete(null);
    }
  };
  
  // Fetch farms data with farmer profiles
  useEffect(() => {
    const fetchFarms = async () => {
      try {
        setFarmsLoading(true);
        
        // Fetch farms with farmer profile information
        const { data: farmsWithProfiles, error } = await supabase
          .from('farms')
          .select(`
            id, 
            farm_name, 
            farm_latitude, 
            farm_longitude, 
            farm_address,
            farmer_id,
            profiles:farmer_id (
              id,
              username,
              full_name
            )
          `)
          .order('farm_name');
        
        if (error) {
          console.error('Error fetching farms:', error);
          setFarmsData([]);
        } else {
          setFarmsData(farmsWithProfiles || []);
          
          // Build farmer profiles map for quick lookup
          const profilesMap = new Map();
          farmsWithProfiles?.forEach((farm: any) => {
            if (farm.profiles) {
              profilesMap.set(farm.farmer_id, farm.profiles);
            }
          });
          setFarmerProfiles(profilesMap);
        }
      } catch (error) {
        console.error('Error fetching farms:', error);
        setFarmsData([]);
      } finally {
        setFarmsLoading(false);
      }
    };
    
    fetchFarms();
  }, []);
  
  // Check if data context is available
  if (!dataContext) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="flex items-center justify-center min-h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-[#388E3C]" />
          </div>
        </AppShell>
      </AuthGuard>
    );
  }
  
  const safeScans = useMemo(() => {
    try {
      if (!dataContext?.scans) {
        console.log('[DataViz] No scans in dataContext');
        return [];
      }
      const scans = Array.isArray(dataContext.scans) ? dataContext.scans : [];
      console.log('[DataViz] Total scans loaded:', scans.length);
      return scans;
    } catch (error) {
      console.error("Error processing scans:", error);
      return [];
    }
  }, [dataContext?.scans]);

  const safeValidationHistory = useMemo(() => {
    try {
      if (!dataContext?.validationHistory) return [];
      return Array.isArray(dataContext.validationHistory) ? dataContext.validationHistory : [];
    } catch (error) {
      console.error("Error processing validation history:", error);
      return [];
    }
  }, [dataContext?.validationHistory]);

  // Validate custom date range
  useEffect(() => {
    if (range === "custom" && customStartDate && customEndDate) {
      const start = new Date(customStartDate);
      const end = new Date(customEndDate);
      const today = new Date().toISOString().split('T')[0];
      
      if (customEndDate > today) {
        setCustomEndDate(today);
        return;
      }
      
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
      return new Date();
    }
  }, [range, customEndDate]);

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

  // Filter scans by date range only (for metrics and charts)
  const dateFilteredScans = useMemo(() => {
    const filtered = safeScans.filter((scan) => {
      if (!scan?.created_at) return false;
      try {
        const scanDate = new Date(scan.created_at);
        if (isNaN(scanDate.getTime())) return false;
        const scanTime = scanDate.getTime();
        const rangeStartTime = rangeStart.getTime();
        let rangeEndTime = rangeEnd.getTime();
        if (range === "this_week" || range === "this_month") {
          rangeEndTime = new Date().getTime();
        }
        return scanTime >= rangeStartTime && scanTime <= rangeEndTime;
      } catch {
        return false;
      }
    });
    console.log('[DataViz] Date filtered scans:', filtered.length, 'Range:', range, 'Start:', rangeStart.toISOString(), 'End:', rangeEnd.toISOString());
    return filtered;
  }, [safeScans, rangeStart, rangeEnd, range]);

  // Filter scans by date range AND map filters (for map display only)
  const filteredScans = useMemo(() => {
    return dateFilteredScans.filter((scan) => {
      // Scan type filter
      if (scanTypeFilter !== "all") {
        if (scanTypeFilter === "leaf_disease" && !isLeafDiseaseScan(scan)) return false;
        if (scanTypeFilter === "fruit_maturity" && !isFruitRipenessScan(scan)) return false;
      }
      
      // Disease/ripeness filter
      if (diseaseFilter !== "all") {
        const prediction = getAiPrediction(scan);
        if (prediction !== diseaseFilter) return false;
      }
      
      // Farm filter
      if (farmFilter !== "all") {
        if (scan.farm_id !== farmFilter) return false;
      }
      
      return true;
    });
  }, [dateFilteredScans, scanTypeFilter, diseaseFilter, farmFilter]);

  // Get unique predictions for filter dropdown
  const uniquePredictions = useMemo(() => {
    const predictions = new Set<string>();
    safeScans.forEach(scan => {
      const prediction = getAiPrediction(scan);
      if (prediction && prediction !== 'Unknown') {
        predictions.add(prediction);
      }
    });
    return Array.from(predictions).sort();
  }, [safeScans]);

  // Calculate total scans count
  const totalScansCount = useMemo(() => dateFilteredScans.length, [dateFilteredScans]);

  // Calculate validated scans count
  const validatedScansCount = useMemo(() => {
    return dateFilteredScans.filter((scan) => scan.status !== "Pending" && scan.status !== "Pending Validation").length;
  }, [dateFilteredScans]);

  // Calculate Most Detected Leaf Disease
  const mostDetectedDisease = useMemo(() => {
    const diseaseCounts = new Map<string, number>();
    dateFilteredScans.filter(isLeafDiseaseScan).forEach((scan) => {
      const prediction = getAiPrediction(scan);
      // Only filter Unknown in this specific calculation
      if (prediction && prediction !== 'Unknown') {
        diseaseCounts.set(prediction, (diseaseCounts.get(prediction) || 0) + 1);
      }
    });
    
    console.log('[DataViz] Most Detected Leaf Disease counts:', Object.fromEntries(diseaseCounts));

    if (diseaseCounts.size === 0) return "No data";
    
    let maxDisease = "";
    let maxCount = 0;
    diseaseCounts.forEach((count, disease) => {
      if (count > maxCount) {
        maxCount = count;
        maxDisease = disease;
      }
    });

    return maxDisease || "No data";
  }, [dateFilteredScans]);

  // Calculate Most Detected Fruit Ripeness
  const mostDetectedRipeness = useMemo(() => {
    const ripenessCounts = new Map<string, number>();
    dateFilteredScans.filter(isFruitRipenessScan).forEach((scan) => {
      const prediction = getAiPrediction(scan);
      // Only filter Unknown in this specific calculation
      if (prediction && prediction !== 'Unknown') {
        ripenessCounts.set(prediction, (ripenessCounts.get(prediction) || 0) + 1);
      }
    });
    
    console.log('[DataViz] Most Detected Fruit Ripeness counts:', Object.fromEntries(ripenessCounts));

    if (ripenessCounts.size === 0) return "No data";
    
    let maxRipeness = "";
    let maxCount = 0;
    ripenessCounts.forEach((count, ripeness) => {
      if (count > maxCount) {
        maxCount = count;
        maxRipeness = ripeness;
      }
    });

    return maxRipeness || "No data";
  }, [dateFilteredScans]);

  // Calculate Average Monthly Performance
  // Note: This is monthly-based and should NOT be affected by time filters
  const averageMonthlyPerformance = useMemo(() => {
    const performance = buildAppPerformance(safeScans, safeValidationHistory);
    console.log('[DataViz] App Performance data:', performance.length, 'items');
    if (performance.length === 0) return 0;
    const avgSuccessRate = performance.reduce((sum, p) => sum + p.successRate, 0) / performance.length;
    return parseFloat(avgSuccessRate.toFixed(1));
  }, [safeScans, safeValidationHistory]);

  // Build data for all charts with error handling
  // Note: App Performance and Monthly Most Scanned are purely monthly-based
  // and should NOT be affected by time filters
  const appPerformance = useMemo(() => {
    try {
      return buildAppPerformance(safeScans, safeValidationHistory);
    } catch (error) {
      console.error("Error building app performance:", error);
      return [];
    }
  }, [safeScans, safeValidationHistory]);

  const monthlyMostScanned = useMemo(() => {
    try {
      const result = buildMonthlyMostScanned(safeScans);
      console.log('[DataViz] Monthly most scanned data:', result.length, 'items');
      return result;
    } catch (error) {
      console.error("Error building monthly most scanned:", error);
      return [];
    }
  }, [safeScans]);

  const expertValidationPerformance = useMemo(() => {
    try {
      // Filter validation history based on selected time period
      const filteredValidations = safeValidationHistory.filter((vh) => {
        if (!vh?.validated_at) return false;
        try {
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
      
      // Use filtered validations for the chart
      return buildExpertValidationPerformance(filteredValidations);
    } catch (error) {
      console.error("Error building expert validation performance:", error);
      return [];
    }
  }, [safeValidationHistory, rangeStart, rangeEnd, range]);

  // Calculate AI accuracy rate with error handling
  const aiAccuracyRate = useMemo(() => {
    try {
      const filteredValidations = safeValidationHistory.filter((vh) => {
        if (!vh?.validated_at) return false;
        try {
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

      if (filteredValidations.length === 0) return 0;

      const validatedCount = filteredValidations.filter((vh) => vh.status === "Validated").length;
      const correctedCount = filteredValidations.filter((vh) => vh.status === "Corrected").length;
      const totalValidatedOrCorrected = validatedCount + correctedCount;

      if (totalValidatedOrCorrected === 0) return 0;

      return parseFloat(((validatedCount / totalValidatedOrCorrected) * 100).toFixed(1));
    } catch (error) {
      console.error("Error calculating AI accuracy rate:", error);
      return 0;
    }
  }, [safeValidationHistory, rangeStart, rangeEnd, range]);

  return (
    <AuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-[#388E3C]" />
          </div>
        }>
          <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Header Section with Title */}
            <div className="space-y-3">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Data Visualization</h1>
                <p className="text-gray-600 text-sm">Advanced Analytics & Farm Disease Mapping</p>
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
              
              {/* Map Filters Toggle - Right Side */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="border-gray-300 hover:bg-gray-50 text-sm font-medium self-start sm:self-center"
              >
                <Filter className="h-4 w-4 mr-1.5" />
                {showFilters ? 'Hide' : 'Show'} Map Filters
                {(scanTypeFilter !== 'all' || diseaseFilter !== 'all' || farmFilter !== 'all') && (
                  <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-[#388E3C] rounded-full">
                    {[scanTypeFilter !== 'all', diseaseFilter !== 'all', farmFilter !== 'all'].filter(Boolean).length}
                  </span>
                )}
              </Button>
            </div>

            {/* Additional Map Filters (Collapsible) */}
            {showFilters && (
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Scan Type Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <Camera className="h-4 w-4" />
                      Scan Type
                    </label>
                    <select
                      value={scanTypeFilter}
                      onChange={(e) => setScanTypeFilter(e.target.value as "all" | "leaf_disease" | "fruit_maturity")}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-colors"
                    >
                      <option value="all">All Scans</option>
                      <option value="leaf_disease">Leaf Disease</option>
                      <option value="fruit_maturity">Fruit Maturity</option>
                    </select>
                  </div>

                  {/* Disease/Ripeness Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Disease/Ripeness
                    </label>
                    <select
                      value={diseaseFilter}
                      onChange={(e) => setDiseaseFilter(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-colors"
                    >
                      <option value="all">All Predictions</option>
                      {uniquePredictions.map(prediction => (
                        <option key={prediction} value={prediction}>
                          {prediction}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Farm Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Farm Location
                    </label>
                    <select
                      value={farmFilter}
                      onChange={(e) => setFarmFilter(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-colors"
                      disabled={farmsLoading}
                    >
                      <option value="all">All Farms</option>
                      {farmsData.map(farm => (
                        <option key={farm.id} value={farm.id}>
                          {farm.farm_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Clear Filters Button */}
                {(scanTypeFilter !== 'all' || diseaseFilter !== 'all' || farmFilter !== 'all') && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setScanTypeFilter('all');
                        setDiseaseFilter('all');
                        setFarmFilter('all');
                      }}
                      className="text-sm text-gray-600 hover:text-gray-900"
                    >
                      <X className="h-4 w-4 mr-1.5" />
                      Clear All Filters
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* KPI Cards Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-4">
              {[
                {
                  icon: TrendingUp,
                  label: "AI Accuracy Rate",
                  value: `${aiAccuracyRate}%`,
                  tone: "text-green-600"
                },
                {
                  icon: AlertCircle,
                  label: "Most Detected Leaf Disease",
                  value: mostDetectedDisease,
                  valueClass: "text-xl",
                  tone: "text-red-600"
                },
                {
                  icon: AlertCircle,
                  label: "Most Detected Fruit Ripeness",
                  value: mostDetectedRipeness,
                  valueClass: "text-xl",
                  tone: "text-green-600"
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
                      <p className={`${metric.valueClass || 'text-2xl'} font-bold text-gray-900`}>{metric.value}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Expert Validation Performance - Chart and AI Accuracy Rate Row */}
          <div className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 items-stretch">
              {/* Expert Validation Performance Chart - 70% width (7 columns) */}
              <div className="lg:col-span-7 flex">
                <Card className="w-full shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden flex flex-col flex-1 h-full" data-chart="expertValidation">
                  <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 flex-shrink-0">
                    <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                      Expert Validation Performance
                    </CardTitle>
                    <p className="text-sm text-white/90 mt-1" style={{ color: 'white' }}>AI Prediction vs Expert Validation Comparison</p>
                  </CardHeader>
                  <CardContent className="pt-4 px-5 pb-4 flex-1 flex flex-col items-center justify-center min-h-0">
                    {expertValidationPerformance.length > 0 && isPageVisible ? (() => {
                      const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                      const sortedData = [...expertValidationPerformance].sort((a, b) => {
                        const aIndex = monthOrder.indexOf(a.month);
                        const bIndex = monthOrder.indexOf(b.month);
                        return aIndex - bIndex;
                      });

                      return (
                        <div className="flex-1 w-full flex items-center justify-center" style={{ minHeight: 280 }}>
                          <ResponsiveContainer key={`validation-perf-${chartKey}`} width="100%" height={280}>
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
                                formatter={(value: number | undefined, name: string | undefined) => {
                                  const val = value ?? 0;
                                  if (name === "aiValidated") return [`${val.toLocaleString("en-US")}`, "Expert Validated (Confirmed)"];
                                  if (name === "aiCorrected") return [`${val.toLocaleString("en-US")}`, "Expert Corrected"];
                                  if (name === "totalValidations") return [`${val.toLocaleString("en-US")}`, "Total Validations"];
                                  return [`${val}`, name];
                                }}
                                labelFormatter={(label: any) => `Month: ${String(label)}`}
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
                    <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                      AI Accuracy Rate
                    </CardTitle>
                    <p className="text-sm text-white/90 mt-1" style={{ color: 'white' }}>Analysis for all time</p>
                  </CardHeader>
                  <CardContent className="pt-4 px-6 pb-4 flex-1 flex flex-col min-h-0">
                    {isPageVisible && (() => {
                      let level = "Needs Improvement";
                      let color = "#EF4444";
                      if (aiAccuracyRate >= 90) {
                        level = "Excellent";
                        color = "#22C55E";
                      } else if (aiAccuracyRate >= 75) {
                        level = "Good";
                        color = "#3B82F6";
                      } else if (aiAccuracyRate >= 50) {
                        level = "Average";
                        color = "#EAB308";
                      }

                      const pieData = [
                        { name: "Accuracy", value: aiAccuracyRate },
                        { name: "Remaining", value: Math.max(0, 100 - aiAccuracyRate) },
                      ];

                      return (
                        <div className="flex flex-col gap-3 flex-1 justify-between">
                          <div className="w-full flex-shrink-0">
                            <div className="relative mx-auto" style={{ maxWidth: 260, minHeight: 200 }}>
                              <ResponsiveContainer key={`ai-accuracy-${chartKey}`} width="100%" height={200}>
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
                                    formatter={(value: number | undefined, name: string | undefined) => [`${(value ?? 0).toFixed(1)}%`, name]}
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

          {/* Monthly Most Scanned - Combined Graph */}
          <div className="mt-6" data-chart="monthlyMostScanned">
            <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden">
              <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                      Monthly Most Scanned Categories
                    </CardTitle>
                    <p className="text-sm text-white/90 mt-1" style={{ color: 'white' }}>Disease & ripeness breakdown by month with scan counts</p>
                  </div>
                  <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                    <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>
                </div>
              </CardHeader>
              <CardContent className="pt-4 px-6 pb-6">
                {monthlyMostScanned.length > 0 && isPageVisible ? (() => {
                  const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                  const sortedData = [...monthlyMostScanned].sort((a, b) => {
                    const aIndex = monthOrder.indexOf(a.month);
                    const bIndex = monthOrder.indexOf(b.month);
                    return aIndex - bIndex;
                  });

                  // Calculate max value for Y-axis from both groups
                  const maxValue = Math.max(
                    ...sortedData.map(item => Math.max(item.totalDiseaseCount, item.totalRipenessCount)),
                    0
                  );
                  
                  let maxDomain = 5;
                  let tickInterval = 1;
                  
                  if (maxValue > 5) {
                    maxDomain = Math.ceil(maxValue / 5) * 5;
                    if (maxDomain > 20) {
                      tickInterval = 5;
                    } else {
                      tickInterval = 1;
                    }
                  } else if (maxValue === 0) {
                    maxDomain = 5;
                    tickInterval = 1;
                  }

                  const tickCount = maxDomain <= 5 
                    ? 6 
                    : Math.floor(maxDomain / tickInterval) + 1;

                  return (
                    <div style={{ minHeight: 380 }}>
                      <ResponsiveContainer key={`monthly-scanned-${chartKey}`} width="100%" height={380}>
                        <BarChart 
                          data={sortedData} 
                          margin={{ top: 20, right: 20, left: 0, bottom: 20 }}
                          barCategoryGap="15%"
                          barGap={8}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                          <XAxis 
                            dataKey="month" 
                            stroke="#9CA3AF" 
                            fontSize={12} 
                            tick={{ fill: "#6B7280", fontWeight: 500 }}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                            tickMargin={12}
                          />
                          <YAxis 
                            stroke="#9CA3AF" 
                            fontSize={12} 
                            tick={{ fill: "#6B7280", fontWeight: 500 }} 
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, maxDomain]}
                            ticks={maxDomain <= 5 
                              ? [0, 1, 2, 3, 4, 5]
                              : Array.from({ length: tickCount }, (_, i) => i * tickInterval)
                            }
                            width={40}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#FFFFFF",
                              border: "1px solid #E5E7EB",
                              borderRadius: "8px",
                              fontSize: "12px",
                              padding: "12px",
                              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                            }}
                            content={({ active, payload, label }) => {
                              if (active && payload && payload.length) {
                                const monthData = payload[0].payload;
                                const hasDiseases = monthData.totalDiseaseCount > 0;
                                const hasRipeness = monthData.totalRipenessCount > 0;
                                
                                return (
                                  <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg">
                                    <p className="font-semibold text-gray-900 mb-2">{label}</p>
                                    <div className="space-y-1">
                                      {/* Leaf Diseases Group */}
                                      {hasDiseases ? (
                                        <div className="mb-3">
                                          <p className="text-xs font-semibold text-red-700 mb-1.5 flex items-center gap-1">
                                            Leaf Diseases <span className="text-gray-500 font-normal">({monthData.totalDiseaseCount} total)</span>
                                          </p>
                                          <div className="ml-4 space-y-0.5">
                                            {monthData['Disease_Healthy'] > 0 && (
                                              <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#22C55E]"></span>
                                                Healthy: <span className="font-semibold">{monthData['Disease_Healthy']}</span>
                                              </p>
                                            )}
                                            {monthData['Disease_Cercospora'] > 0 && (
                                              <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#EF4444]"></span>
                                                Cercospora: <span className="font-semibold">{monthData['Disease_Cercospora']}</span>
                                              </p>
                                            )}
                                            {monthData['Disease_Yellow Mosaic Virus'] > 0 && (
                                              <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#F59E0B]"></span>
                                                Yellow Mosaic Virus: <span className="font-semibold">{monthData['Disease_Yellow Mosaic Virus']}</span>
                                              </p>
                                            )}
                                            {monthData['Disease_Downy Mildew'] > 0 && (
                                              <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#3B82F6]"></span>
                                                Downy Mildew: <span className="font-semibold">{monthData['Disease_Downy Mildew']}</span>
                                              </p>
                                            )}
                                            {monthData['Disease_Fusarium Wilt'] > 0 && (
                                              <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#8B5CF6]"></span>
                                                Fusarium Wilt: <span className="font-semibold">{monthData['Disease_Fusarium Wilt']}</span>
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-xs text-gray-400 italic mb-2">No leaf disease scans</p>
                                      )}
                                      
                                      {/* Fruit Ripeness Group */}
                                      {hasRipeness ? (
                                        <div>
                                          <p className="text-xs font-semibold text-green-700 mb-1.5 flex items-center gap-1">
                                            Fruit Ripeness <span className="text-gray-500 font-normal">({monthData.totalRipenessCount} total)</span>
                                          </p>
                                          <div className="ml-4 space-y-0.5">
                                            {monthData['Ripeness_Immature'] > 0 && (
                                              <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#10B981]"></span>
                                                Immature: <span className="font-semibold">{monthData['Ripeness_Immature']}</span>
                                              </p>
                                            )}
                                            {monthData['Ripeness_Mature'] > 0 && (
                                              <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#FBBF24]"></span>
                                                Mature: <span className="font-semibold">{monthData['Ripeness_Mature']}</span>
                                              </p>
                                            )}
                                            {monthData['Ripeness_Overmature'] > 0 && (
                                              <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#F97316]"></span>
                                                Overmature: <span className="font-semibold">{monthData['Ripeness_Overmature']}</span>
                                              </p>
                                            )}
                                            {monthData['Ripeness_Overripe'] > 0 && (
                                              <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#DC2626]"></span>
                                                Overripe: <span className="font-semibold">{monthData['Ripeness_Overripe']}</span>
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-xs text-gray-400 italic">No fruit ripeness scans</p>
                                      )}
                                      
                                      {!hasDiseases && !hasRipeness && (
                                        <p className="text-xs text-gray-500 italic">No scans recorded this month</p>
                                      )}
                                    </div>
                                    {monthData.totalCount > 0 && (
                                      <p className="text-xs font-semibold text-gray-900 mt-2 pt-2 border-t">
                                        Total Scans: {monthData.totalCount}
                                      </p>
                                    )}
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Legend 
                            verticalAlign="bottom"
                            align="center"
                            iconType="square"
                            iconSize={10}
                            wrapperStyle={{ paddingTop: "20px", fontSize: "11px" }}
                            content={({ payload }) => (
                              <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-red-700">Leaf Diseases:</span>
                                  <div className="flex flex-wrap gap-2">
                                    <div className="flex items-center gap-1">
                                      <span className="w-2.5 h-2.5 rounded bg-[#22C55E]"></span>
                                      <span className="text-gray-600">Healthy</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="w-2.5 h-2.5 rounded bg-[#EF4444]"></span>
                                      <span className="text-gray-600">Cercospora</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="w-2.5 h-2.5 rounded bg-[#F59E0B]"></span>
                                      <span className="text-gray-600">Yellow Mosaic</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="w-2.5 h-2.5 rounded bg-[#3B82F6]"></span>
                                      <span className="text-gray-600">Downy Mildew</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="w-2.5 h-2.5 rounded bg-[#8B5CF6]"></span>
                                      <span className="text-gray-600">Fusarium Wilt</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-green-700">Fruit Ripeness:</span>
                                  <div className="flex flex-wrap gap-2">
                                    <div className="flex items-center gap-1">
                                      <span className="w-2.5 h-2.5 rounded bg-[#10B981]"></span>
                                      <span className="text-gray-600">Immature</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="w-2.5 h-2.5 rounded bg-[#FBBF24]"></span>
                                      <span className="text-gray-600">Mature</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="w-2.5 h-2.5 rounded bg-[#F97316]"></span>
                                      <span className="text-gray-600">Overmature</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="w-2.5 h-2.5 rounded bg-[#DC2626]"></span>
                                      <span className="text-gray-600">Overripe</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          />
                          {/* Leaf Disease Bars (Left Group) - Green palette */}
                          <Bar
                            dataKey="Disease_Healthy"
                            name="Healthy"
                            stackId="diseases"
                            fill="#22C55E"
                            radius={[0, 0, 0, 0]}
                            animationDuration={600}
                          />
                          <Bar
                            dataKey="Disease_Cercospora"
                            name="Cercospora"
                            stackId="diseases"
                            fill="#EF4444"
                            radius={[0, 0, 0, 0]}
                            animationDuration={600}
                          />
                          <Bar
                            dataKey="Disease_Yellow Mosaic Virus"
                            name="Yellow Mosaic Virus"
                            stackId="diseases"
                            fill="#F59E0B"
                            radius={[0, 0, 0, 0]}
                            animationDuration={600}
                          />
                          <Bar
                            dataKey="Disease_Downy Mildew"
                            name="Downy Mildew"
                            stackId="diseases"
                            fill="#3B82F6"
                            radius={[0, 0, 0, 0]}
                            animationDuration={600}
                          />
                          <Bar
                            dataKey="Disease_Fusarium Wilt"
                            name="Fusarium Wilt"
                            stackId="diseases"
                            fill="#8B5CF6"
                            radius={[6, 6, 0, 0]}
                            animationDuration={600}
                          />
                          {/* Fruit Ripeness Bars (Right Group) - Orange/Yellow palette */}
                          <Bar
                            dataKey="Ripeness_Immature"
                            name="Immature"
                            stackId="ripeness"
                            fill="#10B981"
                            radius={[0, 0, 0, 0]}
                            animationDuration={600}
                          />
                          <Bar
                            dataKey="Ripeness_Mature"
                            name="Mature"
                            stackId="ripeness"
                            fill="#FBBF24"
                            radius={[0, 0, 0, 0]}
                            animationDuration={600}
                          />
                          <Bar
                            dataKey="Ripeness_Overmature"
                            name="Overmature"
                            stackId="ripeness"
                            fill="#F97316"
                            radius={[0, 0, 0, 0]}
                            animationDuration={600}
                          />
                          <Bar
                            dataKey="Ripeness_Overripe"
                            name="Overripe"
                            stackId="ripeness"
                            fill="#DC2626"
                            radius={[6, 6, 0, 0]}
                            animationDuration={600}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })() : (
                  <div className="flex h-[280px] flex-col items-center justify-center">
                    <div className="text-center">
                      <BarChart3 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                      <p className="text-sm font-medium text-gray-500">No monthly scan data available yet</p>
                      <p className="text-xs text-gray-400 mt-1">Data will appear here as scans are recorded</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

            {/* Interactive Farm Disease Map - Moved to Bottom */}
            <div className="mt-6">
              {typeof window !== 'undefined' && (
                <InteractiveFarmMap
                  key={`map-${scanTypeFilter}-${diseaseFilter}-${farmFilter}-${filteredScans.length}`}
                  scans={filteredScans}
                  farms={farmsData}
                  filters={{
                    scanType: scanTypeFilter,
                    disease: diseaseFilter,
                    farm: farmFilter
                  }}
                />
              )}
            </div>

            {/* Detection Records Table */}
            <div className="mt-6">
              <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden">
                <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                        Detection Records
                      </CardTitle>
                      <p className="text-sm text-white/90 mt-1" style={{ color: 'white' }}>Comprehensive scan history</p>
                    </div>
                    <div className="relative w-full sm:w-auto">
                      <input
                        type="text"
                        placeholder="Search by disease, farm, or type..."
                        value={recordsSearchQuery}
                        onChange={(e) => {
                          setRecordsSearchQuery(e.target.value);
                          setRecordsCurrentPage(1);
                        }}
                        className="w-full sm:w-72 pl-9 pr-4 py-2 text-sm bg-white border-0 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-white/50 placeholder:text-gray-400 text-gray-700"
                      />
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 px-5 pb-4">
                  {(() => {
                    // Filter and search records
                    const searchedRecords = dateFilteredScans.filter(scan => {
                      if (!recordsSearchQuery) return true;
                      const query = recordsSearchQuery.toLowerCase();
                      const prediction = getAiPrediction(scan)?.toLowerCase() || '';
                      const farmName = farmsData.find(f => f.id === scan.farm_id)?.farm_name?.toLowerCase() || '';
                      const scanType = scan.scan_type?.toLowerCase() || '';
                      return prediction.includes(query) || farmName.includes(query) || scanType.includes(query);
                    });

                    const totalRecords = searchedRecords.length;
                    const totalPages = Math.ceil(totalRecords / recordsPerPage);
                    const startIndex = (recordsCurrentPage - 1) * recordsPerPage;
                    const paginatedRecords = searchedRecords.slice(startIndex, startIndex + recordsPerPage);

                    if (paginatedRecords.length === 0) {
                      return (
                        <div className="flex h-[200px] flex-col items-center justify-center">
                          <div className="text-center">
                            <Camera className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                            <p className="text-sm font-medium text-gray-500">No detection records found</p>
                            <p className="text-xs text-gray-400 mt-1">Scan data will appear here as records are added</p>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div>
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-gray-100">
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Disease Detected</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Farmer Name and Farm Location</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {paginatedRecords.map((scan, idx) => {
                                const prediction = getAiPrediction(scan);
                                const farm = farmsData.find(f => f.id === scan.farm_id);
                                const farmName = farm?.farm_name || 'Unknown Farm';
                                // Use scan.farmer_profile from DataContext instead of farm lookup
                                const farmerProfile = scan.farmer_profile;
                                const farmerName = farmerProfile?.full_name || farmerProfile?.username || 'Unknown Farmer';
                                const locationDisplay = `${farmerName} (${farmName})`;
                                const scanDate = scan.created_at ? new Date(scan.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
                                
                                // Status mapping - use actual database values
                                let statusColor = 'bg-gray-100 text-gray-600';
                                let statusText: string = scan.status || 'pending';
                                
                                // Normalize status to lowercase for comparison
                                const normalizedStatus = scan.status?.toLowerCase() || 'pending';
                                
                                if (normalizedStatus === 'validated') {
                                  statusColor = 'bg-emerald-100 text-emerald-700';
                                  statusText = 'validated';
                                } else if (normalizedStatus === 'corrected') {
                                  statusColor = 'bg-blue-100 text-blue-700';
                                  statusText = 'corrected';
                                } else {
                                  statusColor = 'bg-amber-100 text-amber-700';
                                  statusText = 'pending';
                                }

                                return (
                                  <tr key={scan.scan_uuid || `${scan.scan_type}-${scan.id}-${idx}`} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="py-3 px-4 text-sm text-gray-600">{scanDate}</td>
                                    <td className="py-3 px-4 text-sm text-gray-900 font-medium">{prediction || 'Unknown'}</td>
                                    <td className="py-3 px-4 text-sm text-blue-600">{locationDisplay}</td>
                                    <td className="py-3 px-4">
                                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${statusColor}`}>
                                        {statusText}
                                      </span>
                                    </td>
                                    <td className="py-3 px-4">
                                      <button 
                                        onClick={() => handleDeleteScan(scan)}
                                        disabled={isDeleting}
                                        className="p-1.5 hover:bg-red-50 rounded-lg transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Delete scan"
                                      >
                                        <svg className="w-4 h-4 text-gray-400 group-hover:text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination */}
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                          <p className="text-sm text-gray-500">
                            Showing {startIndex + 1} to {Math.min(startIndex + recordsPerPage, totalRecords)} of {totalRecords} results
                          </p>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setRecordsCurrentPage(prev => Math.max(prev - 1, 1))}
                              disabled={recordsCurrentPage === 1}
                              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              Previous
                            </button>
                            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                              let pageNum = i + 1;
                              if (totalPages > 5) {
                                if (recordsCurrentPage > 3) {
                                  pageNum = recordsCurrentPage - 2 + i;
                                }
                                if (pageNum > totalPages) pageNum = totalPages - 4 + i;
                              }
                              return (
                                <button
                                  key={pageNum}
                                  onClick={() => setRecordsCurrentPage(pageNum)}
                                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                                    recordsCurrentPage === pageNum
                                      ? 'bg-[#388E3C] text-white'
                                      : 'text-gray-600 hover:bg-gray-50'
                                  }`}
                                >
                                  {pageNum}
                                </button>
                              );
                            })}
                            <button
                              onClick={() => setRecordsCurrentPage(prev => Math.min(prev + 1, totalPages))}
                              disabled={recordsCurrentPage === totalPages}
                              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>
        </div>
        </Suspense>

        {/* Delete Confirmation Modal */}
        <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
          <DialogContent className="sm:max-w-[380px] p-0">
            <div className="flex flex-col items-center text-center px-6 pt-8 pb-6">
              {/* Title */}
              <h2 className="text-xl font-semibold text-gray-900 mb-3">
                Confirm Deletion
              </h2>
              
              {/* Message */}
              <p className="text-sm text-gray-600 leading-relaxed mb-6">
                Are you sure you want to delete this {scanToDelete?.scan_type === 'leaf_disease' ? 'leaf disease' : 'fruit ripeness'} scan? This action cannot be undone.
              </p>
              
              {/* Buttons */}
              <div className="flex items-center justify-center gap-3 w-full">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setScanToDelete(null);
                  }}
                  disabled={isDeleting}
                  className="min-w-[100px]"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="default"
                  onClick={confirmDeleteScan}
                  disabled={isDeleting}
                  className="bg-red-600 hover:bg-red-700 text-white min-w-[100px]"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete'
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AuthGuard>
  );
}
