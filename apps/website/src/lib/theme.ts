export const APP_THEME = "light" as const;

export const THEME_SWITCHING_ENABLED: boolean = false;

export function themeProviderProps(switching: boolean = THEME_SWITCHING_ENABLED) {
  return {
    attribute: "class" as const,
    defaultTheme: APP_THEME,
    forcedTheme: switching ? undefined : APP_THEME,
    enableSystem: false,
    disableTransitionOnChange: true,
  };
}
