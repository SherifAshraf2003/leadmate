export interface User {
  id: string;
  email: string;
  business_name: string;
  business_type?: string;
  whatsapp_number?: string;
  business_industry?: string;
  business_logo_url?: string;
  twilio_phone_sid?: string;
  twilio_phone_number?: string;
  twilio_sender_sid?: string;
  twilio_waba_id?: string;
  whatsapp_status?: string;
  // GREEN-API fields
  greenapi_instance_id?: string;
  greenapi_token?: string;
  subscription_status: "trial" | "active" | "cancelled";
  usage_count: number;
  usage_limit: number;
  stripe_customer_id?: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
