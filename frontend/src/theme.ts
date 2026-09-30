import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: { main: "#22543d", contrastText: "#ffffff" },
    secondary: { main: "#a7322b" },
    background: { default: "#f7f8f5", paper: "#ffffff" },
    text: { primary: "#1a241e", secondary: "#657069" },
    divider: "#dce2dd",
  },
  shape: { borderRadius: 0 },
  typography: {
    fontFamily: "var(--font-sport), sans-serif",
    button: { fontWeight: 600, textTransform: "none" },
  },
  components: {
    MuiButton: {
      styleOverrides: { root: { borderRadius: 0, boxShadow: "none" } },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 0 } },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 0,
          textTransform: "none",
          fontWeight: 600,
        },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { borderRadius: 0, boxShadow: "none" } },
    },
  },
});

export default theme;