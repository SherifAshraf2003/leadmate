import { z } from "zod";

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  business_name: z.string(),
  business_type: z.string(),
  whatsapp_number: z.string().regex(/^\+[1-9]\d{1,14}$/),
  business_industry: z.string(),
  business_logo_url: z.string().url(),
  twilio_phone_sid: z.string(),
  twilio_phone_number: z.string().regex(/^\+[1-9]\d{1,14}$/),
  twilio_sender_sid: z.string(),
  twilio_waba_id: z.string(),
  whatsapp_status: z.string(),
  // GREEN-API fields
  greenapi_instance_id: z.string().optional(),
  greenapi_token: z.string().optional(),
  subscription_status: z.enum(["trial", "active", "cancelled"]),
  usage_count: z.number(),
  usage_limit: z.number(),
  stripe_customer_id: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});