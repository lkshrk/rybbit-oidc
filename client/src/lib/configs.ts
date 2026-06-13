import { useQuery } from "@tanstack/react-query";
import { authedFetch } from "../api/utils";

interface Configs {
  disableSignup: boolean;
  disableCredentialLogin: boolean;
  mapboxToken: string;
  liteDashboard: boolean;
  oidcProvider: {
    name: string;
  } | null;
}

export function useConfigs() {
  const { data, isLoading, error } = useQuery<Configs>({
    queryKey: ["configs"],
    queryFn: () => authedFetch<Configs>("/config"),
  });

  return {
    configs: data,
    isLoading,
    error,
  };
}
