import {
  Phone,
  Brain,
  Globe,
  Upload,
  MessageSquare,
  MessageCircle,
} from "lucide-react";

export const ONBOARDING_STEPS = [
  { number: 1, title: "Business Info", icon: Phone },
  { number: 2, title: "Upload Knowledge", icon: Brain },
  { number: 3, title: "Pick a Number", icon: Globe },
  { number: 4, title: "WhatsApp Access", icon: MessageCircle },
  { number: 5, title: "Activate", icon: Upload },
  { number: 6, title: "Done", icon: MessageSquare },
];

export const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "EG", label: "Egypt" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "GB", label: "United Kingdom" },
  { value: "SA", label: "Saudi Arabia" },
];

export const INDUSTRIES = [
  { value: "", label: "Select your industry" },
  { value: "restaurant", label: "Restaurant" },
  { value: "retail", label: "Retail" },
  { value: "service", label: "Service" },
  { value: "healthcare", label: "Healthcare" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" },
];

export const INITIAL_ONBOARDING_DATA = {
  businessName: "",
  businessType: "",
  logoUrl: "",
  knowledgeContent: "",
  selectedCountry: "US",
  selectedNumber: "",
  senderSid: "",
  whatsappActivated: false,
  activationStatus: "PENDING",
  // GREEN-API fields
  greenApiInstanceId: "",
  greenApiToken: "",
  greenApiConnected: false,
};
