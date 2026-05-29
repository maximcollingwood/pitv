import { useEffect, useState } from "react";
import { api, type Config } from "./api";

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => setError("Could not load configuration."));
  }, []);

  return { config, error };
}
