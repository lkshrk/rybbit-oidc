"use client";

import { ExternalLink } from "lucide-react";
import { useExtracted } from "next-intl";
import { useState } from "react";

import { SiteResponse } from "@/api/admin/endpoints";
import { CodeSnippet } from "@/components/CodeSnippet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface DashboardEmbedTabProps {
  siteMetadata: SiteResponse;
  sitePublic: boolean;
  disabled?: boolean;
  togglingPublic: boolean;
  onTogglePublic: (checked: boolean) => void;
}

const DASHBOARD_PREVIEW_WIDTH = 1920;
const DASHBOARD_PREVIEW_HEIGHT = 1080;
const DASHBOARD_PREVIEW_SCALE = 0.3;

type DashboardEmbedTheme = "light" | "dark" | "system";

function useDashboardEmbedThemes() {
  const t = useExtracted();

  return [
    { value: "light" as const, label: t("Light") },
    { value: "dark" as const, label: t("Dark") },
    { value: "system" as const, label: t("System") },
  ];
}

export function DashboardEmbedTab({
  siteMetadata,
  sitePublic,
  disabled = false,
  togglingPublic,
  onTogglePublic,
}: DashboardEmbedTabProps) {
  const t = useExtracted();
  const themes = useDashboardEmbedThemes();
  const [hideDashboardSidebar, setHideDashboardSidebar] = useState(true);
  const [dashboardTheme, setDashboardTheme] = useState<DashboardEmbedTheme>("system");

  const siteId = siteMetadata.siteId;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const dashboardUrl = new URL(`${origin}/${siteId}/main`);
  dashboardUrl.searchParams.set("embed", "true");
  dashboardUrl.searchParams.set("theme", dashboardTheme);
  if (hideDashboardSidebar) {
    dashboardUrl.searchParams.set("hideSidebar", "true");
  }
  const dashboardUrlString = dashboardUrl.toString();

  const dashboardPreviewWidth = DASHBOARD_PREVIEW_WIDTH * DASHBOARD_PREVIEW_SCALE;
  const dashboardPreviewHeight = DASHBOARD_PREVIEW_HEIGHT * DASHBOARD_PREVIEW_SCALE;

  const dashboardIframeCode = `<iframe
  src="${dashboardUrlString}"
  style="border: 0; width: 100%; height: 720px;"
  loading="lazy"
  title="Analytics dashboard"
></iframe>`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="dashboard-public" className="text-sm font-medium text-foreground">
            {t("Public Analytics")}
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            {t("Anyone can view your site analytics without logging in")}
          </p>
        </div>
        <Switch
          id="dashboard-public"
          checked={sitePublic}
          disabled={disabled || togglingPublic}
          onCheckedChange={onTogglePublic}
        />
      </div>

      <section className="space-y-4">
        <div>
          <h5 className="text-xs font-semibold text-foreground uppercase tracking-wide">{t("Public Dashboard")}</h5>
          <p className="text-xs text-muted-foreground mt-1">
            {t("Embed the public main analytics dashboard on another site.")}
          </p>
        </div>

        <fieldset
          disabled={!sitePublic}
          className={`space-y-4 transition-opacity ${!sitePublic ? "opacity-50 pointer-events-none select-none" : ""}`}
          aria-disabled={!sitePublic}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label className="text-sm font-medium text-foreground">{t("Theme")}</Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t("Choose how the embedded dashboard is displayed.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {themes.map(theme => (
                <Button
                  key={theme.value}
                  type="button"
                  size="sm"
                  variant={dashboardTheme === theme.value ? "default" : "outline"}
                  onClick={() => setDashboardTheme(theme.value)}
                >
                  {theme.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="dashboard-hide-sidebar" className="text-sm font-medium text-foreground">
                {t("Hide sidebar")}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t("Only the main dashboard page can be viewed from this embed.")}
              </p>
            </div>
            <Switch
              id="dashboard-hide-sidebar"
              checked={hideDashboardSidebar}
              onCheckedChange={setHideDashboardSidebar}
            />
          </div>
        </fieldset>

        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-foreground uppercase tracking-wide">{t("Try It Out")}</h5>
          <div
            className={`rounded-md border border-neutral-200 dark:border-neutral-800 p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between transition-opacity ${
              !sitePublic ? "opacity-50" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {sitePublic
                  ? t("Open the generated dashboard embed URL in a new tab.")
                  : t("Make this site public to try the dashboard embed.")}
              </p>
              <div className="mt-2 truncate rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 font-mono text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
                {dashboardUrlString}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!sitePublic}
              onClick={() => window.open(dashboardUrlString, "_blank", "noopener,noreferrer")}
              className="shrink-0 self-start sm:self-center"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("Open")}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-foreground uppercase tracking-wide">{t("Preview")}</h5>
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-2 bg-neutral-100 dark:bg-neutral-950">
            {sitePublic ? (
              <div
                className="mx-auto overflow-hidden rounded-sm bg-white dark:bg-neutral-950"
                style={{
                  width: dashboardPreviewWidth,
                  maxWidth: "100%",
                  height: dashboardPreviewHeight,
                }}
              >
                <iframe
                  key={dashboardUrlString}
                  src={dashboardUrlString}
                  width={DASHBOARD_PREVIEW_WIDTH}
                  height={DASHBOARD_PREVIEW_HEIGHT}
                  style={{
                    border: 0,
                    width: DASHBOARD_PREVIEW_WIDTH,
                    height: DASHBOARD_PREVIEW_HEIGHT,
                    transform: `scale(${DASHBOARD_PREVIEW_SCALE})`,
                    transformOrigin: "top left",
                  }}
                  title="Dashboard preview"
                />
              </div>
            ) : (
              <div className="h-[220px] rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 flex items-center justify-center text-xs text-muted-foreground">
                {t("Make this site public to preview")}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-foreground uppercase tracking-wide">{t("Embed Code")}</h5>
          <CodeSnippet language="HTML" code={dashboardIframeCode} />
        </div>
      </section>
    </div>
  );
}
