"use client";

import { useState, useEffect } from "react";
import { OnboardingStepProps } from "./types";
import {
  MessageCircle,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
  QrCode,
  Key,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";

const GREENAPI_CONSOLE_URL = "https://console.green-api.com";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

// Moved OUTSIDE the component to prevent re-creation on every render
function StepCard({
  stepNumber,
  title,
  children,
  imageSrc,
  imageAlt,
  isExpanded,
  onToggle,
}: {
  stepNumber: number;
  title: string;
  children: React.ReactNode;
  imageSrc?: string;
  imageAlt?: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-2 border-border rounded-base overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 bg-secondary-background hover:bg-secondary-background/80 transition-colors"
      >
        <div className="w-8 h-8 bg-main rounded-base border border-border flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-semibold text-main-foreground">
            {stepNumber}
          </span>
        </div>
        <h5 className="text-sm font-medium text-foreground flex-1 text-left">
          {title}
        </h5>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-foreground/60" />
        ) : (
          <ChevronDown className="h-4 w-4 text-foreground/60" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 border-t-2 border-border bg-background">
          <div className="space-y-4">
            {children}
            {imageSrc && (
              <div className="relative w-full aspect-video bg-secondary-background rounded-base border-2 border-border overflow-hidden flex items-center justify-center">
                <Image
                  src={imageSrc}
                  alt={imageAlt || "Step screenshot"}
                  fill
                  className="object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GreenApiActivationStep({
  data,
  setData,
}: OnboardingStepProps) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string>("");
  const [expandedStep, setExpandedStep] = useState<number | null>(4); // Start with credentials step open
  const [qrCode, setQrCode] = useState<string>("");
  const [qrLoading, setQrLoading] = useState(false);
  const [instanceStatus, setInstanceStatus] = useState<string>("");
  
  // Local state for inputs to prevent parent re-renders on every keystroke
  const [localInstanceId, setLocalInstanceId] = useState(data.greenApiInstanceId);
  const [localApiToken, setLocalApiToken] = useState(data.greenApiToken);

  // Sync local state to parent when values change (debounced via blur or explicit sync)
  const syncToParent = () => {
    if (localInstanceId !== data.greenApiInstanceId || localApiToken !== data.greenApiToken) {
      setData({
        ...data,
        greenApiInstanceId: localInstanceId,
        greenApiToken: localApiToken,
      });
    }
  };

  // Check existing connection on mount
  useEffect(() => {
    if (data.greenApiInstanceId && data.greenApiToken) {
      checkConnectionStatus();
    }
  }, []);

  // Poll for authorization status when QR code is displayed
  useEffect(() => {
    if (instanceStatus !== "notAuthorized" || !qrCode) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch("/api/greenApi/instance");
        const result = await response.json();

        if (result.status === "authorized") {
          setStatus("connected");
          setInstanceStatus("authorized");
          setData({ ...data, greenApiConnected: true });
          setQrCode(""); // Clear QR code
        }
      } catch (err) {
        console.error("Failed to poll status:", err);
      }
    }, 3000); // Check every 3 seconds

    return () => clearInterval(pollInterval);
  }, [instanceStatus, qrCode, data, setData]);

  // Auto-refresh QR code every 15 seconds (expires in 20s per GREEN-API docs)
  useEffect(() => {
    if (instanceStatus !== "notAuthorized" || !qrCode || qrLoading) {
      return;
    }

    const refreshInterval = setInterval(() => {
      fetchQrCode();
    }, 15000); // Refresh every 15 seconds

    return () => clearInterval(refreshInterval);
  }, [instanceStatus, qrCode, qrLoading]);

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch("/api/greenApi/instance");
      const result = await response.json();

      if (result.connected && result.status === "authorized") {
        setStatus("connected");
        setInstanceStatus("authorized");
        setData({ ...data, greenApiConnected: true });
      } else if (result.connected) {
        setInstanceStatus(result.status);
        if (result.status === "notAuthorized") {
          fetchQrCode();
        }
      }
    } catch (err) {
      console.error("Failed to check connection:", err);
    }
  };

  const fetchQrCode = async () => {
    setQrLoading(true);
    try {
      const response = await fetch("/api/greenApi/qr");
      const result = await response.json();

      if (result.status === "authorized") {
        setStatus("connected");
        setInstanceStatus("authorized");
        setData({ ...data, greenApiConnected: true });
      } else if (result.qrCode) {
        setQrCode(result.qrCode);
      }
    } catch (err) {
      console.error("Failed to fetch QR:", err);
    } finally {
      setQrLoading(false);
    }
  };

  const handleConnect = async () => {
    // Sync local state first
    syncToParent();
    
    if (!localInstanceId || !localApiToken) {
      setError("Please enter both Instance ID and API Token");
      return;
    }

    setStatus("connecting");
    setError("");

    try {
      const response = await fetch("/api/greenApi/instance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instanceId: localInstanceId,
          apiToken: localApiToken,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Failed to connect");
        setStatus("error");
        return;
      }

      if (result.status === "authorized") {
        setStatus("connected");
        setInstanceStatus("authorized");
        setData({ ...data, greenApiInstanceId: localInstanceId, greenApiToken: localApiToken, greenApiConnected: true });
      } else {
        // Reset to idle so UI shows QR code section, not loading state
        setStatus("idle");
        setInstanceStatus(result.status);
        setExpandedStep(null); // Collapse steps to show QR code prominently
        fetchQrCode();
      }
    } catch (err) {
      setError("Connection failed. Please check your credentials.");
      setStatus("error");
    }
  };

  const toggleStep = (step: number) => {
    setExpandedStep(expandedStep === step ? null : step);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto w-12 h-12 bg-green-500 rounded-base border-2 border-border shadow-shadow flex items-center justify-center mb-4">
          <MessageCircle className="h-6 w-6 text-white" />
        </div>
        <h3 className="text-xl font-heading text-foreground mb-2">
          Connect Your WhatsApp
        </h3>
        <p className="text-sm text-foreground/70">
          Set up GREEN-API to power your WhatsApp chatbot
        </p>
      </div>

      {/* Success State */}
      {status === "connected" && instanceStatus === "authorized" && (
        <div className="bg-green-50 border-2 border-green-200 rounded-base p-6">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-green-800">
                WhatsApp Connected Successfully! 🎉
              </h4>
              <p className="text-xs text-green-700 mt-1">
                Your chatbot is ready to receive messages. You can proceed to
                the next step.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step-by-Step Guide */}
      {status !== "connected" && (
        <div className="space-y-3">
          {/* Step 1: Create Account */}
          <StepCard
            stepNumber={1}
            title="Create a FREE GREEN-API Account"
            imageSrc="/images/greenapi/step1-signup.png"
            imageAlt="GREEN-API signup page"
            isExpanded={expandedStep === 1}
            onToggle={() => toggleStep(1)}
          >
            <p className="text-xs text-foreground/70">
              Go to GREEN-API and create a free account. The Developer plan
              gives you 1 free WhatsApp instance.
            </p>
            <Button
              variant="neutral"
              size="sm"
              onClick={() => window.open(GREENAPI_CONSOLE_URL, "_blank")}
              className="flex items-center gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Open GREEN-API Console
            </Button>
          </StepCard>

          {/* Step 2: Create Instance */}
          <StepCard
            stepNumber={2}
            title="Create a New Instance"
            imageSrc="/images/greenapi/step2-create-instance.png"
            imageAlt="Create instance button"
            isExpanded={expandedStep === 2}
            onToggle={() => toggleStep(2)}
          >
            <p className="text-xs text-foreground/70">
              After signing up, click "Create Instance" in your dashboard. This
              creates a WhatsApp connection for your business.
            </p>
          </StepCard>

          {/* Step 3: Scan QR Code */}
          <StepCard
            stepNumber={3}
            title="Scan QR Code with WhatsApp"
            imageSrc="/images/greenapi/step3-scan-qr.png"
            imageAlt="QR code scanning"
            isExpanded={expandedStep === 3}
            onToggle={() => toggleStep(3)}
          >
            <p className="text-xs text-foreground/70">
              Open WhatsApp on your phone → Settings → Linked Devices → Link a
              Device → Scan the QR code shown in GREEN-API.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-base p-3">
              <p className="text-xs text-amber-700">
                <strong>💡 Tip:</strong> Use WhatsApp Business app for better
                business features!
              </p>
            </div>
          </StepCard>

          {/* Step 4: Copy Credentials */}
          <StepCard
            stepNumber={4}
            title="Copy Your Credentials"
            imageSrc="/images/greenapi/step4-copy-credentials.png"
            imageAlt="Instance credentials"
            isExpanded={expandedStep === 4}
            onToggle={() => toggleStep(4)}
          >
            <p className="text-xs text-foreground/70">
              After your WhatsApp is connected, copy the <strong>Instance ID</strong> and{" "}
              <strong>API Token</strong> from your GREEN-API dashboard.
            </p>

            {/* Credential Input Fields */}
            <div className="space-y-4 mt-4 p-4 bg-secondary-background rounded-base border border-border">
              <div className="space-y-2">
                <Label
                  htmlFor="instanceId"
                  className="text-sm font-medium flex items-center gap-2"
                >
                  <Key className="h-4 w-4" />
                  Instance ID
                </Label>
                <Input
                  id="instanceId"
                  type="text"
                  placeholder="e.g., 7105431366"
                  value={localInstanceId}
                  onChange={(e) => setLocalInstanceId(e.target.value)}
                  onBlur={syncToParent}
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="apiToken"
                  className="text-sm font-medium flex items-center gap-2"
                >
                  <Key className="h-4 w-4" />
                  API Token
                </Label>
                <Input
                  id="apiToken"
                  type="password"
                  placeholder="Your API token from GREEN-API"
                  value={localApiToken}
                  onChange={(e) => setLocalApiToken(e.target.value)}
                  onBlur={syncToParent}
                  className="font-mono"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-600 text-xs">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              <Button
                onClick={handleConnect}
                disabled={
                  status === "connecting" ||
                  !localInstanceId ||
                  !localApiToken
                }
                className="w-full bg-green-500 hover:bg-green-600 text-white"
              >
                {status === "connecting" ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Connect WhatsApp
                  </>
                )}
              </Button>
            </div>
          </StepCard>
        </div>
      )}

      {/* QR Code Display (if credentials connected but WhatsApp not authorized) */}
      {instanceStatus === "notAuthorized" && qrCode && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-base border-2 border-green-200 shadow-shadow">
          <div className="flex flex-col items-center gap-5">
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center gap-2 bg-green-500 text-white px-4 py-2 rounded-full">
                <QrCode className="h-4 w-4" />
                <span className="text-sm font-semibold">Scan to Connect</span>
              </div>
              <p className="text-sm text-green-800/80 max-w-xs">
                Open WhatsApp → Settings → Linked Devices → Scan this code
              </p>
            </div>

            {/* QR Code Container */}
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-green-400 to-emerald-400 rounded-xl blur opacity-30"></div>
              <div className="relative bg-white p-4 rounded-xl border-2 border-green-200 shadow-lg">
                <img
                  src={qrCode}
                  alt="WhatsApp QR Code"
                  className="w-52 h-52 object-contain"
                />
              </div>
            </div>

            {/* Footer with status */}
            <div className="flex flex-col items-center gap-3">
              {/* Waiting indicator */}
              <div className="flex items-center gap-2 text-green-700">
                <div className="relative">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-ping absolute"></div>
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                </div>
                <span className="text-sm font-medium">Waiting for scan...</span>
              </div>
              
              <p className="text-xs text-green-700/60">
                QR code auto-refreshes every 15 seconds
              </p>
              
              <Button 
                variant="neutral" 
                size="sm" 
                onClick={fetchQrCode}
                disabled={qrLoading}
                className="bg-white hover:bg-green-50 border-green-200 text-green-700 hover:text-green-800 transition-colors"
              >
                {qrLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {qrLoading ? "Refreshing..." : "Refresh Now"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Help Section */}
      <div className="bg-blue-50 border-2 border-blue-200 rounded-base p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-blue-800">
              Need help?
            </h4>
            <p className="text-xs text-blue-700 mt-1">
              The Developer plan is completely free and includes 1 WhatsApp
              instance. You can create unlimited free accounts if needed.
            </p>
          </div>
        </div>
      </div>

      {/* Confirmation checkbox for connected state */}
      {status === "connected" && (
        <div className="bg-secondary-background p-4 rounded-base border-2 border-border">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="greenapi-confirmation"
              checked={data.greenApiConnected}
              onChange={(e) =>
                setData({ ...data, greenApiConnected: e.target.checked })
              }
              className="mt-1 h-4 w-4 text-main focus:ring-main border-border rounded"
            />
            <div className="flex-1">
              <Label
                htmlFor="greenapi-confirmation"
                className="text-sm font-medium text-foreground cursor-pointer"
              >
                ✅ My WhatsApp is connected and ready
              </Label>
              <p className="text-xs text-foreground/70 mt-1">
                Check this box to confirm your WhatsApp connection is active.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

