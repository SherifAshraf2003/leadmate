"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Sparkles } from "lucide-react";
import {
  BusinessInfoStep,
  KnowledgeUploadStep,
  GreenApiActivationStep,
  CompletionStep,
  type OnboardingData,
  INITIAL_ONBOARDING_DATA,
} from "@/components/onboarding";
import { useOnboardingMutations } from "@/hooks/useOnboarding";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Simplified onboarding progress component
function SimplifiedOnboardingProgress({
  currentStep,
}: {
  currentStep: number;
}) {
  const steps = [
    {
      number: 1,
      title: "Business Info",
      description: "Tell us about your business",
    },
    {
      number: 2,
      title: "Knowledge Base",
      description: "Upload your business knowledge",
    },
    {
      number: 3,
      title: "Connect WhatsApp",
      description: "Set up GREEN-API",
    },
    { number: 4, title: "Complete", description: "You're all set!" },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto px-2 sm:px-4">
      {/* Steps without connectors */}
      <div className="flex items-center justify-between">
        {steps.map((step) => (
          <div key={step.number} className="flex flex-col items-center flex-1">
            <div
              className={`w-8 h-8 sm:w-10 md:w-12 sm:h-10 md:h-12 rounded-full border-2 flex items-center justify-center text-xs sm:text-sm font-medium transition-all duration-300 ${
                currentStep >= step.number
                  ? "bg-main border-main text-main-foreground shadow-md"
                  : "border-border bg-background text-foreground/60"
              }`}
            >
              {step.number}
            </div>
            <div className="mt-2 sm:mt-3 text-center px-1">
              <p className="text-xs sm:text-sm font-medium text-foreground">
                {step.title}
              </p>
              <p className="text-xs text-foreground/60 mt-1 hidden sm:block">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Progress indicator */}
      <div className="mt-6 sm:mt-8">
        <div className="w-full bg-border rounded-full h-1.5 sm:h-2">
          <div
            className="bg-white h-1.5 sm:h-2 rounded-full transition-all duration-500 ease-in-out"
            style={{ width: `${(currentStep / steps.length) * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-foreground/60">
          <span>Start</span>
          <span className="hidden sm:inline">
            {Math.round((currentStep / steps.length) * 100)}% Complete
          </span>
          <span className="sm:hidden">
            {Math.round((currentStep / steps.length) * 100)}%
          </span>
          <span>Finish</span>
        </div>
      </div>
    </div>
  );
}

// Simplified navigation component
function SimplifiedOnboardingNavigation({
  step,
  loading,
  data,
  onNext,
  onBack,
}: {
  step: number;
  loading: boolean;
  data: OnboardingData;
  onNext: () => void;
  onBack: () => void;
}) {
  const canProceed = () => {
    switch (step) {
      case 1:
        return data.businessName.trim() && data.businessType.trim();
      case 2:
        return data.knowledgeContent?.trim();
      case 3:
        return data.greenApiConnected;
      default:
        return true;
    }
  };

  return (
    <div className="flex flex-col sm:flex-row justify-between items-center mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-border gap-4 sm:gap-0">
      <Button
        variant="reverse"
        onClick={onBack}
        disabled={step === 1 || loading}
        className="px-4 sm:px-6 w-full sm:w-auto order-2 sm:order-1"
      >
        Back
      </Button>

      <div className="flex items-center gap-2 text-sm text-foreground/60 order-1 sm:order-2">
        Step {step} of 4
      </div>

      <Button
        onClick={onNext}
        disabled={!canProceed() || loading}
        className="px-4 sm:px-6 w-full sm:w-auto order-3"
      >
        {loading ? "Processing..." : step === 4 ? "Complete Setup" : "Continue"}
      </Button>
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>(INITIAL_ONBOARDING_DATA);
  const router = useRouter();

  const {
    saveBusinessInfo,
    uploadKnowledge,
    isLoading: mutationsLoading,
  } = useOnboardingMutations();

  const handleNext = async () => {
    if (step === 1) {
      await handleSaveBusinessInfo();
      return;
    }
    if (step === 2) {
      await handleUploadKnowledge();
      return;
    }
    if (step === 3) {
      setStep(4);
      return;
    }
    if (step === 4) {
      await completeOnboarding();
      return;
    }
  };

  const completeOnboarding = async () => {
    try {
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to complete onboarding:", errorData.error);
        return;
      }

      router.push("/dashboard");
    } catch (error) {
      console.error("Onboarding error:", error);
    }
  };

  const handleSaveBusinessInfo = async () => {
    try {
      await saveBusinessInfo.mutateAsync({
        businessName: data.businessName,
        businessType: data.businessType,
        logoUrl: data.logoUrl,
      });
      setStep(2);
    } catch (error) {
      console.error("Failed to save business info:", error);
    }
  };

  const handleUploadKnowledge = async () => {
    try {
      // Knowledge content is required
      if (!data.knowledgeContent?.trim()) {
        return; // Button should be disabled, but just in case
      }

      await uploadKnowledge.mutateAsync(data.knowledgeContent);
      setStep(3);
    } catch (error) {
      console.error("Failed to upload knowledge:", error);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b-2 border-border bg-secondary-background">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-main rounded-base border-2 border-border shadow-shadow">
                <Bot className="h-5 w-5 sm:h-6 sm:w-6 text-main-foreground" />
              </div>
              <div className="text-center sm:text-left">
                <h1 className="text-lg sm:text-xl font-heading text-foreground">
                  LeadMate Setup
                </h1>
                <p className="text-xs sm:text-sm text-foreground/70">
                  Get started with your AI assistant
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs sm:text-sm text-foreground/60">
              <Sparkles className="h-3 w-3 sm:h-4 sm:w-4" />
              Step {step} of 4
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Progress Steps */}
        <SimplifiedOnboardingProgress currentStep={step} />

        {/* Step Content */}
        <div className="mt-6 sm:mt-8">
          <Card className="max-w-2xl mx-auto transition-all duration-300 ease-in-out">
            <CardContent className="p-4 sm:p-6 lg:p-8">
              {/* Render step content based on current step with fade transitions */}
              <div className="transition-all duration-500 ease-in-out">
                {step === 1 && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                    <BusinessInfoStep data={data} setData={setData} />
                  </div>
                )}
                {step === 2 && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                    <KnowledgeUploadStep data={data} setData={setData} />
                  </div>
                )}
                {step === 3 && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                    <GreenApiActivationStep data={data} setData={setData} />
                  </div>
                )}
                {step === 4 && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                    <CompletionStep />
                  </div>
                )}
              </div>

              {/* Navigation */}
              <SimplifiedOnboardingNavigation
                step={step}
                loading={mutationsLoading}
                data={data}
                onNext={handleNext}
                onBack={() => setStep(step - 1)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
