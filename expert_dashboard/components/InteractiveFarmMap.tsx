"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { MapPin, Loader2, Leaf, Apple, Filter, X } from "lucide-react";
import type { Scan } from "@/types";
import { getAiPrediction, isLeafDiseaseScan, isFruitRipenessScan } from "@/types";

// Import Leaflet CSS
import "leaflet/dist/leaflet.css";

// Standalone map wrapper component that uses vanilla Leaflet
function LeafletMapWrapper({
  center,
  zoom,
  farmMapData,
  leafletIcon,
  selectedFarm,
  setSelectedFarm,
  getDiseaseColor,
  getRipenessColor,
}: {
  center: { lat: number; lng: number };
  zoom: number;
  farmMapData: FarmMapData[];
  leafletIcon: any;
  selectedFarm: string | null;
  setSelectedFarm: (id: string) => void;
  getDiseaseColor: (disease: string) => string;
  getRipenessColor: (stage: string) => string;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !mapContainerRef.current || !leafletIcon) return;

    // Dynamic import of Leaflet
    import("leaflet").then((L) => {
      // Check if map already exists and remove it
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      // Clear the container's leaflet ID to prevent "already initialized" error
      const container = mapContainerRef.current;
      if (container && (container as any)._leaflet_id) {
        delete (container as any)._leaflet_id;
      }

      // Create new map instance
      const map = L.map(container!, {
        center: [center.lat, center.lng],
        zoom: zoom,
        scrollWheelZoom: true,
      });

      // Add tile layer
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // Clear existing markers
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];

      // Add markers for each farm
      farmMapData.forEach((farm) => {
        const marker = L.marker([farm.latitude, farm.longitude], { icon: leafletIcon })
          .addTo(map)
          .on("click", () => setSelectedFarm(farm.farm_id));

        // Create popup content
        const popupContent = createPopupContent(farm, getDiseaseColor, getRipenessColor);
        marker.bindPopup(popupContent, { className: "custom-popup", minWidth: 280 });

        markersRef.current.push(marker);
      });

      mapInstanceRef.current = map;

      // Force a resize after render to fix any display issues
      setTimeout(() => {
        map.invalidateSize();
      }, 100);
    });

    // Cleanup function
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      markersRef.current = [];
    };
  }, [center.lat, center.lng, zoom, farmMapData, leafletIcon, setSelectedFarm, getDiseaseColor, getRipenessColor]);

  return (
    <div
      ref={mapContainerRef}
      style={{ height: "400px", width: "100%", position: "relative", zIndex: 0 }}
    />
  );
}

// Helper function to create popup HTML content
function createPopupContent(
  farm: FarmMapData,
  getDiseaseColor: (disease: string) => string,
  getRipenessColor: (stage: string) => string
): string {
  let content = `
    <div style="padding: 8px; min-width: 280px;">
      <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb;">
        <h3 style="font-weight: bold; color: #111827; font-size: 14px; display: flex; align-items: center; gap: 8px;">
          📍 ${farm.farm_name}
        </h3>
        <p style="font-size: 11px; color: #6b7280; margin-top: 4px;">
          ${farm.latitude.toFixed(4)}, ${farm.longitude.toFixed(4)}
        </p>
  `;

  if (farm.total_scans > 0) {
    const level = farm.total_scans >= 16 ? 'High' : farm.total_scans >= 6 ? 'Medium' : 'Low';
    const levelEmoji = farm.total_scans >= 16 ? '🔴' : farm.total_scans >= 6 ? '🟡' : '🟢';
    const bgColor = farm.total_scans >= 16 ? '#fee2e2' : farm.total_scans >= 6 ? '#fef3c7' : '#dcfce7';
    const textColor = farm.total_scans >= 16 ? '#b91c1c' : farm.total_scans >= 6 ? '#a16207' : '#15803d';

    content += `
        <div style="margin-top: 8px;">
          <span style="background: ${bgColor}; color: ${textColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
            ${levelEmoji} ${level} Concentration
          </span>
        </div>
        <p style="font-size: 11px; color: #4b5563; margin-top: 8px;">
          <strong>Total Detection Count:</strong> ${farm.total_scans} ${farm.total_scans === 1 ? 'scan' : 'scans'}
        </p>
        <p style="font-size: 11px; color: #4b5563;">
          <strong>Latest Scan:</strong> ${farm.latest_scan_date ? new Date(farm.latest_scan_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
        </p>
    `;
  } else {
    content += `
        <p style="font-size: 11px; color: #6b7280; margin-top: 8px; font-style: italic;">
          No scan data recorded yet for this farm
        </p>
    `;
  }

  content += `</div>`;

  // Leaf Diseases section
  if (farm.leaf_diseases.size > 0) {
    content += `
      <div style="margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 8px;">
          <span style="color: #388E3C;">🌿</span>
          <h4 style="font-weight: 600; font-size: 11px; color: #374151;">Leaf Diseases</h4>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
    `;
    farm.leaf_diseases.forEach((count, disease) => {
      content += `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 10px; height: 10px; border-radius: 50%; background: ${getDiseaseColor(disease)};"></div>
              <span style="color: #1f2937;">${disease}</span>
            </div>
            <span style="font-weight: 600; color: #374151; background: #f3f4f6; padding: 2px 8px; border-radius: 4px;">${count}</span>
          </div>
      `;
    });
    content += `</div></div>`;
  }

  // Fruit Ripeness section
  if (farm.fruit_ripeness.size > 0) {
    content += `
      <div>
        <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 8px;">
          <span style="color: #F97316;">🍎</span>
          <h4 style="font-weight: 600; font-size: 11px; color: #374151;">Fruit Ripeness</h4>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
    `;
    farm.fruit_ripeness.forEach((count, stage) => {
      content += `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 10px; height: 10px; border-radius: 50%; background: ${getRipenessColor(stage)};"></div>
              <span style="color: #1f2937;">${stage}</span>
            </div>
            <span style="font-weight: 600; color: #374151; background: #f3f4f6; padding: 2px 8px; border-radius: 4px;">${count}</span>
          </div>
      `;
    });
    content += `</div></div>`;
  }

  content += `</div>`;
  return content;
}

type Farm = {
  id: string;
  farm_name: string;
  farm_latitude: number;
  farm_longitude: number;
  farm_address?: string;
};

type FarmMapData = {
  farm_id: string;
  farm_name: string;
  latitude: number;
  longitude: number;
  leaf_diseases: Map<string, number>;
  fruit_ripeness: Map<string, number>;
  total_scans: number;
  latest_scan_date: string;
};

type InteractiveFarmMapProps = {
  scans: Scan[];
  farms?: Farm[];
  filters?: {
    scanType?: "all" | "leaf_disease" | "fruit_maturity";
    disease?: string;
    farm?: string;
  };
  showAllFarms?: boolean; // New prop to show all farms even without scans
};

export default function InteractiveFarmMap({
  scans,
  farms = [],
  filters = {},
  showAllFarms = true, // Default to showing all farms
}: InteractiveFarmMapProps) {
  const [isClient, setIsClient] = useState(false);
  const [leafletIcon, setLeafletIcon] = useState<any>(null);
  const [selectedFarm, setSelectedFarm] = useState<string | null>(null);

  // Ensure component only renders on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Load Leaflet icon
  useEffect(() => {
    if (!isClient) return;

    import("leaflet").then((L) => {
      const icon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });
      setLeafletIcon(icon);
    });
  }, [isClient]);

  // Process and aggregate farm data
  const farmMapData = useMemo(() => {
    const farmDataMap = new Map<string, FarmMapData>();

    // If showAllFarms is true, initialize all farms first
    if (showAllFarms && farms.length > 0) {
      farms.forEach((farm) => {
        if (farm.farm_latitude && farm.farm_longitude) {
          farmDataMap.set(farm.id, {
            farm_id: farm.id,
            farm_name: farm.farm_name,
            latitude: farm.farm_latitude,
            longitude: farm.farm_longitude,
            leaf_diseases: new Map(),
            fruit_ripeness: new Map(),
            total_scans: 0,
            latest_scan_date: "",
          });
        }
      });
    }

    // Filter scans based on filters
    let filteredScans = scans;

    // Exclude Non-Ampalaya scans — they are not valid Ampalaya detections
    filteredScans = filteredScans.filter((scan) => {
      const prediction = getAiPrediction(scan);
      if (!prediction) return true;
      const lower = prediction.toLowerCase();
      return !lower.includes('non-ampalaya') && !lower.includes('non ampalaya');
    });
    
    if (filters.scanType && filters.scanType !== "all") {
      filteredScans = filteredScans.filter(
        (scan) => scan.scan_type === filters.scanType
      );
    }

    if (filters.disease && filters.disease !== "all") {
      filteredScans = filteredScans.filter((scan) => {
        const prediction = getAiPrediction(scan);
        return prediction === filters.disease;
      });
    }

    if (filters.farm && filters.farm !== "all") {
      filteredScans = filteredScans.filter((scan) => scan.farm_id === filters.farm);
    }

    filteredScans.forEach((scan) => {
      // Skip scans without farm_id
      if (!scan.farm_id) return;

      const prediction = getAiPrediction(scan);
      if (!prediction || prediction === "Unknown") return;

      // Find farm details - if no farm found in the farms array, skip this scan
      const farm = farms.find((f) => f.id === scan.farm_id);
      if (!farm || !farm.farm_latitude || !farm.farm_longitude) return;

      // Get or create farm data
      if (!farmDataMap.has(scan.farm_id)) {
        // Use scan coordinates if available, otherwise use farm coordinates
        const latitude = scan.scan_latitude ?? farm.farm_latitude;
        const longitude = scan.scan_longitude ?? farm.farm_longitude;

        farmDataMap.set(scan.farm_id, {
          farm_id: scan.farm_id,
          farm_name: farm.farm_name,
          latitude,
          longitude,
          leaf_diseases: new Map(),
          fruit_ripeness: new Map(),
          total_scans: 0,
          latest_scan_date: scan.created_at || "",
        });
      }

      const farmData = farmDataMap.get(scan.farm_id)!;
      farmData.total_scans++;

      // Update latest scan date
      if (scan.created_at && scan.created_at > farmData.latest_scan_date) {
        farmData.latest_scan_date = scan.created_at;
      }

      // Categorize by scan type
      if (isLeafDiseaseScan(scan)) {
        farmData.leaf_diseases.set(
          prediction,
          (farmData.leaf_diseases.get(prediction) || 0) + 1
        );
      } else if (isFruitRipenessScan(scan)) {
        farmData.fruit_ripeness.set(
          prediction,
          (farmData.fruit_ripeness.get(prediction) || 0) + 1
        );
      }
    });

    return Array.from(farmDataMap.values());
  }, [scans, farms, filters, showAllFarms]);

  // Calculate map center
  const mapCenter = useMemo(() => {
    if (farmMapData.length === 0) {
      return { lat: 14.5995, lng: 120.9842 }; // Default to Philippines
    }

    if (selectedFarm) {
      const farm = farmMapData.find((f) => f.farm_id === selectedFarm);
      if (farm) {
        return { lat: farm.latitude, lng: farm.longitude };
      }
    }

    const avgLat =
      farmMapData.reduce((sum, f) => sum + f.latitude, 0) / farmMapData.length;
    const avgLng =
      farmMapData.reduce((sum, f) => sum + f.longitude, 0) / farmMapData.length;

    return { lat: avgLat, lng: avgLng };
  }, [farmMapData, selectedFarm]);

  const getDiseaseColor = (disease: string): string => {
    const colors: Record<string, string> = {
      Healthy: "#388E3C",
      Cercospora: "#F97316",
      "Yellow Mosaic Virus": "#EAB308",
      "Fusarium Wilt": "#EF4444",
      "Downy Mildew": "#3B82F6",
    };
    return colors[disease] || "#6B7280";
  };

  const getRipenessColor = (stage: string): string => {
    const colors: Record<string, string> = {
      Immature: "#EAB308",
      Mature: "#388E3C",
      Overmature: "#F97316",
      Overripe: "#EF4444",
    };
    return colors[stage] || "#6B7280";
  };

  if (!isClient || !leafletIcon) {
    return (
      <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                Farm Disease Map
              </CardTitle>
              <p className="text-sm text-white/90 mt-1" style={{ color: 'white' }}>Interactive disease distribution by farm location</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4 px-5 pb-4">
          <div className="flex h-[400px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#388E3C]" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (farmMapData.length === 0) {
    return (
      <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
                Farm Disease Map
              </CardTitle>
              <p className="text-sm text-white/90 mt-1" style={{ color: 'white' }}>Interactive disease distribution by farm location</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4 px-5 pb-4">
          <div className="flex h-[400px] flex-col items-center justify-center rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-dashed border-gray-300">
            <div className="text-center">
              <svg className="h-16 w-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              <p className="text-base font-semibold text-gray-700">
                Map Data Unavailable
              </p>
              <p className="text-sm text-gray-500 mt-2 max-w-xs mx-auto">
                No scan results found. Please scan crops with location data enabled to view disease distribution on the map.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden">
      <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>
              Farm Disease Map
            </CardTitle>
            <p className="text-sm text-white/90 mt-1" style={{ color: 'white' }}>Interactive disease distribution by farm location</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 px-5 pb-4">
        {/* Heat Map Legend */}
        <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <div className="w-3 h-3 bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 rounded-full" />
            Disease Concentration Level
          </h4>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-green-500 border border-gray-300" />
              <span className="text-gray-600">Low (1-5 cases)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-yellow-500 border border-gray-300" />
              <span className="text-gray-600">Medium (6-15 cases)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-red-500 border border-gray-300" />
              <span className="text-gray-600">High (16+ cases)</span>
            </div>
          </div>
        </div>

        {/* Map Container - Using vanilla Leaflet for better control */}
        <div className="relative rounded-lg overflow-hidden border border-gray-200" style={{ zIndex: 0, isolation: "isolate" }}>
          <LeafletMapWrapper
            center={mapCenter}
            zoom={selectedFarm ? 13 : 10}
            farmMapData={farmMapData}
            leafletIcon={leafletIcon}
            selectedFarm={selectedFarm}
            setSelectedFarm={setSelectedFarm}
            getDiseaseColor={getDiseaseColor}
            getRipenessColor={getRipenessColor}
          />
        </div>

        {/* Farm List Below Map */}
        <div className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
          <h4 className="font-semibold text-sm text-gray-700 mb-3 flex items-center justify-between">
            <span>Farm Locations ({farmMapData.length})</span>
            <span className="text-xs font-normal text-gray-500">Click to focus on map</span>
          </h4>
          {farmMapData
            .sort((a, b) => b.total_scans - a.total_scans) // Sort by scan count descending
            .map((farm) => {
              const heatLevel = farm.total_scans >= 16 ? 'high' : farm.total_scans >= 6 ? 'medium' : 'low';
              const heatColor = heatLevel === 'high' ? 'bg-red-500' : heatLevel === 'medium' ? 'bg-yellow-500' : 'bg-green-500';
              const heatBorder = heatLevel === 'high' ? 'border-red-300' : heatLevel === 'medium' ? 'border-yellow-300' : 'border-green-300';
              
              return (
                <button
                  key={farm.farm_id}
                  onClick={() => setSelectedFarm(farm.farm_id)}
                  className={`w-full text-left p-3 rounded-lg border-2 transition-all duration-200 ${
                    selectedFarm === farm.farm_id
                      ? "border-[#388E3C] bg-[#388E3C]/5 shadow-md"
                      : `${heatBorder} hover:border-[#388E3C]/50 hover:bg-gray-50`
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${heatColor} animate-pulse`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900">
                            {farm.farm_name}
                          </span>
                          {farm.total_scans > 0 && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                              heatLevel === 'high' 
                                ? 'bg-red-100 text-red-700' 
                                : heatLevel === 'medium' 
                                  ? 'bg-yellow-100 text-yellow-700' 
                                  : 'bg-green-100 text-green-700'
                            }`}>
                              {heatLevel === 'high' ? 'High' : heatLevel === 'medium' ? 'Medium' : 'Low'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          📍 {farm.latitude.toFixed(4)}, {farm.longitude.toFixed(4)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm font-bold ${farm.total_scans > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                        {farm.total_scans > 0 ? farm.total_scans : '0'}
                      </span>
                      <p className="text-xs text-gray-500">
                        {farm.total_scans === 1 ? 'detection' : 'detections'}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      </CardContent>
    </Card>
  );
}
