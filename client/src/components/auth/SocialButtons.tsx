"use client";

import { Button } from "@/components/ui/button";
import { SiGithub, SiOpenid } from "@icons-pack/react-simple-icons";
import { authClient } from "@/lib/auth";
import { IS_CLOUD } from "@/lib/const";
import { useConfigs } from "@/lib/configs";
import { useExtracted } from "next-intl";
import Image from "next/image";

interface SocialButtonsProps {
  onError: (error: string) => void;
  callbackURL?: string;
  mode?: "signin" | "signup";
  className?: string;
  showEmailDivider?: boolean;
}

export function SocialButtons({
  onError,
  callbackURL,
  mode = "signin",
  className = "",
  showEmailDivider = true,
}: SocialButtonsProps) {
  const t = useExtracted();
  const { configs, isLoading } = useConfigs();

  if (isLoading || !configs) return null;

  const oidcProvider = configs.oidcProvider;
  const hasCloudSocialProviders = IS_CLOUD;
  const hasProviders = hasCloudSocialProviders || Boolean(oidcProvider);

  if (!hasProviders) return null;

  const handleSocialAuth = async (provider: "google" | "github" | "twitter") => {
    try {
      await authClient.signIn.social({
        provider,
        ...(callbackURL ? { callbackURL } : {}),
        // For signup flow, new users should also be redirected to the callbackURL
        ...(mode === "signup" && callbackURL ? { newUserCallbackURL: callbackURL } : {}),
      });
    } catch (error) {
      onError(String(error));
    }
  };

  const handleOidcAuth = async () => {
    try {
      await authClient.signIn.oauth2({
        providerId: "oidc",
        ...(callbackURL ? { callbackURL } : {}),
        ...(mode === "signup" && callbackURL ? { newUserCallbackURL: callbackURL } : {}),
      });
    } catch (error) {
      onError(String(error));
    }
  };

  return (
    <>
      <div className={`flex flex-col gap-2 ${className}`}>
        {oidcProvider && (
          <Button type="button" onClick={handleOidcAuth} className="h-11">
            <SiOpenid />
            {oidcProvider.name}
          </Button>
        )}
        {hasCloudSocialProviders && (
          <>
            <Button type="button" onClick={() => handleSocialAuth("google")} className="h-11">
              <Image src="/crawlers/Google.svg" alt="Google" width={16} height={16} />
              {t("Continue with Google")}
            </Button>
            <Button type="button" onClick={() => handleSocialAuth("github")} className="h-11">
              <SiGithub />
              {t("Continue with GitHub")}
            </Button>
          </>
        )}
      </div>
      {showEmailDivider && (
        <div className="relative flex items-center text-xs uppercase">
          <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
          <span className="px-3 text-muted-foreground">{t("Or continue with email")}</span>
          <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
        </div>
      )}
    </>
  );
}
