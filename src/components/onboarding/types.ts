export interface OnboardingData {
  businessName: string;
  businessType: string;
  logoUrl: string;
  knowledgeContent: string;
  selectedCountry: string;
  selectedNumber: string;
  senderSid: string;
  whatsappActivated: boolean;
  activationStatus: string;
  // GREEN-API fields
  greenApiInstanceId: string;
  greenApiToken: string;
  greenApiConnected: boolean;
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName?: string | null;
  isoCountry?: string | null;
  capabilities?: unknown;
}

export interface OnboardingStepProps {
  data: OnboardingData;
  setData: (data: OnboardingData) => void;
  loading?: boolean;
}

export interface OnboardingNavigationProps {
  step: number;
  loading: boolean;
  data: OnboardingData;
  onNext: () => void;
  onBack: () => void;
}
