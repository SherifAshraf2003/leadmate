"use client";

import Form from "next/form";
import { useActionState, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { toast } from "sonner";
import { updateSettings } from "@/app/dashboard/settings/action";
import { TSettingsFormPrevState } from "@/app/dashboard/settings/schema";
import { TgetSettings } from "@/app/dashboard/settings/schema";
import TwilioInfo from "@/components/dashboard/settings/TwilioInfo";
import AccountStatus from "@/components/dashboard/settings/AccountStatus";
import BusinessInfo from "@/components/dashboard/settings/BusinessInfo";
import ProfilePictureUpload from "@/components/dashboard/settings/ProfilePictureUpload";
import GreenApiSettings from "@/components/dashboard/settings/GreenApiSettings";

export default function SettingsForm({
  settingsData,
  error,
}: {
  settingsData: TgetSettings[];
  error: Error | null;
}) {
  const [currentProfilePic, setCurrentProfilePic] = useState<string>("");

  const [state, formAction, pending] = useActionState<
    TSettingsFormPrevState,
    FormData
  >(settingsClientAction, {
    success: false,
    errors: undefined,
    inputs: {
      username: "",
      business_logo_url: "",
    },
  });

  const handleProfilePicUploadSuccess = useCallback((url: string) => {
    setCurrentProfilePic(url);
  }, []);

  //Error handling
  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <p className="text-red-600">
            Error loading settings:{" "}
            {error instanceof Error ? error.message : String(error)}
          </p>
          <Button
            onClick={() => window.location.reload()}
            variant="neutral"
            className="mt-2"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const settings = settingsData[0] as TgetSettings;

  //Update settings
  async function settingsClientAction(
    prevState: TSettingsFormPrevState,
    fd: FormData
  ): Promise<TSettingsFormPrevState> {
    toast.loading("Updating settings...");
    const result = await updateSettings(prevState, fd);

    if (result.success) {
      toast.dismiss();
      toast.success("Settings updated successfully!");
    } else if (result.errors) {
      if (result.errors.supabase && result.errors.supabase.length > 0) {
        toast.dismiss();
        toast.error(result.errors.supabase.join(", "));
      } else {
        toast.dismiss();
        console.log(result.errors);
        toast.error("Please fix the highlighted errors");
      }
    }
    return result;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your business profile and WhatsApp configuration
        </p>
      </div>

      <Form action={formAction} className="space-y-6">
        {/* Business Profile */}
        <Card>
          <CardHeader>
            <CardTitle>Business Profile</CardTitle>
            <CardDescription>
              Update your business profile details and contact information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Hidden input for profile picture URL */}
            <input
              type="hidden"
              name="business_logo_url"
              value={currentProfilePic || settings.business_logo_url || ""}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">User Name</Label>
                <Input
                  id="username"
                  name="username"
                  defaultValue={state.inputs.username || settings.username}
                  placeholder="Your user name"
                  disabled={pending}
                />
                {state?.errors?.username && (
                  <p className="text-sm text-red-500">
                    {state.errors.username.join(", ")}
                  </p>
                )}
              </div>
              <div className="flex justify-center">
                <ProfilePictureUpload
                  currentImageUrl={
                    currentProfilePic || settings.business_logo_url
                  }
                  onUploadSuccess={handleProfilePicUploadSuccess}
                />
                {state?.errors?.file && (
                  <p className="text-sm text-red-500">
                    {state.errors.file.join(", ")}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button type="submit" disabled={pending} className="min-w-[120px]">
              {pending ? "Saving..." : "Save Changes"}
            </Button>
          </CardFooter>
        </Card>
        {/* Business Information */}
        <BusinessInfo settings={settings} />

        {/* Account Status */}
        <AccountStatus settings={settings} />

        {/* GREEN-API WhatsApp Connection */}
        <GreenApiSettings 
          instanceId={settings.greenapi_instance_id} 
          hasToken={!!settings.greenapi_token}
        />

        {/* Legacy Twilio Configuration (if applicable) */}
        {settings.whatsapp_number && <TwilioInfo settings={settings} />}
      </Form>
    </div>
  );
}
