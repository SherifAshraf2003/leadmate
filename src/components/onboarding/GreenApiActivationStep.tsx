"use client";

import { useState, useEffect } from "react";
import { OnboardingStepProps } from "./types";
import {
  MessageCircle,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
  Copy,
  QrCode,
  Key,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";

const GREENAPI_CONSOLE_URL = "https://console.green-api.com";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export default function GreenApiActivationStep({
  data,
  setData,
}: OnboardingStepProps) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string>("");
  const [expandedStep, setExpandedStep] = useState<number | null>(1);
  const [qrCode, setQrCode] = useState<string>("");
  const [instanceStatus, setInstanceStatus] = useState<string>("");

  // Check existing connection on mount
  useEffect(() => {
    if (data.greenApiInstanceId && data.greenApiToken) {
      checkConnectionStatus();
    }
  }, []);

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch("/api/greenApi/instance", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      });
      const result = await response.json();

      if (result.connected && result.status === "authorized") {
        setStatus("connected");
        setInstanceStatus("authorized");
        setData({ ...data, greenApiConnected: true });
      } else if (result.connected) {
        setInstanceStatus(result.status);
        // Fetch QR if not authorized
        if (result.status === "notAuthorized") {
          fetchQrCode();
        }
      }
    } catch (err) {
      console.error("Failed to check connection:", err);
    }
  };

  const fetchQrCode = async () => {
    try {
      const response = await fetch("/api/greenApi/qr", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      });
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
    }
  };

  const handleConnect = async () => {
    if (!data.greenApiInstanceId || !data.greenApiToken) {
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
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({
          instanceId: data.greenApiInstanceId,
          apiToken: data.greenApiToken,
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
        setData({ ...data, greenApiConnected: true });
      } else {
        setInstanceStatus(result.status);
        // Need to scan QR code
        setExpandedStep(4);
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

  const StepCard = ({
    stepNumber,
    title,
    children,
    imageSrc,
    imageAlt,
  }: {
    stepNumber: number;
    title: string;
    children: React.ReactNode;
    imageSrc?: string;
    imageAlt?: string;
  }) => {
    const isExpanded = expandedStep === stepNumber;

    return (
      <div className="border-2 border-border rounded-base overflow-hidden">
        <button
          onClick={() => toggleStep(stepNumber)}
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
                      // Hide broken image
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
                  value={data.greenApiInstanceId}
                  onChange={(e) =>
                    setData({ ...data, greenApiInstanceId: e.target.value })
                  }
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
                  value={data.greenApiToken}
                  onChange={(e) =>
                    setData({ ...data, greenApiToken: e.target.value })
                  }
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
                  !data.greenApiInstanceId ||
                  !data.greenApiToken
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
        <div className="bg-secondary-background p-6 rounded-base border-2 border-border">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-2">
              <QrCode className="h-5 w-5 text-foreground" />
              <h4 className="text-lg font-semibold text-foreground">
                Scan QR Code
              </h4>
            </div>
            <p className="text-sm text-foreground/70">
              Open WhatsApp → Settings → Linked Devices → Scan this QR code
            </p>
            <div className="bg-white p-4 rounded-base inline-block">
              <img
                src={qrCode}
                alt="WhatsApp QR Code"
                className="w-48 h-48 object-contain"
              />
            </div>
            <Button variant="neutral" size="sm" onClick={fetchQrCode}>
              <Loader2 className="h-4 w-4 mr-2" />
              Refresh QR Code
            </Button>
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

