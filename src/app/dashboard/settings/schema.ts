import { z } from "zod";
import { createFormPrevStateSchema } from "../../../lib/schemas/formPrevState";

export const SettingsInputSchema = z.object({
  username: z.string().min(1, "Username is required"),
  business_logo_url: z.string().url("Please enter a valid URL").optional().or(z.literal("")),
});

export const getSettingsSchema = SettingsInputSchema.extend({
  email: z.string().email(),
  business_name: z
    .string({ required_error: "Business name is required" })
    .min(1, "Business name is required"),
  business_type: z.string().optional().or(z.literal("")),
  business_logo_url: z
    .string()
    .url("Please enter a valid URL")
    .optional()
    .or(z.literal("")),
  whatsapp_number: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, "Please enter a valid WhatsApp number")
    .optional()
    .or(z.literal("")),
  subscription_status: z.string().optional().or(z.literal("trial")),
  usage_count: z.number().optional().or(z.literal(0)),
  usage_limit: z.number().optional().or(z.literal(500)),
  stripe_customer_id: z.string().optional().or(z.literal(null)),
  // GREEN-API fields
  greenapi_instance_id: z.string().optional().nullable(),
  greenapi_token: z.string().optional().nullable(),
});

export type TSettingsInput = z.infer<typeof SettingsInputSchema>;
export type TgetSettings = z.infer<typeof getSettingsSchema>;

export const SettingsFormPrevStateSchema =
  createFormPrevStateSchema(SettingsInputSchema);

export type TSettingsFormPrevState = z.infer<
  typeof SettingsFormPrevStateSchema
>;

