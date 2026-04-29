import 'package:flutter/material.dart';

ThemeData buildCissTheme() {
  const Color brandBlue = Color(0xFF0B4F82);
  const Color brandGold = Color(0xFFC9A75B);
  const Color surface = Color(0xFFF5F7FA);
  const Color textPrimary = Color(0xFF142133);
  const Color textMuted = Color(0xFF607085);

  final ColorScheme colorScheme = ColorScheme.fromSeed(
    seedColor: brandBlue,
    brightness: Brightness.light,
    primary: brandBlue,
    secondary: brandGold,
    surface: surface,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: surface,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: textPrimary,
      elevation: 0,
      centerTitle: false,
      surfaceTintColor: Colors.transparent,
    ),
    cardTheme: const CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(24)),
      ),
    ),
    textTheme: const TextTheme(
      headlineMedium: TextStyle(
        fontSize: 30,
        fontWeight: FontWeight.w800,
        color: textPrimary,
        letterSpacing: -0.8,
      ),
      headlineSmall: TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.w800,
        color: textPrimary,
      ),
      titleLarge: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: textPrimary,
      ),
      titleMedium: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: textPrimary,
      ),
      bodyLarge: TextStyle(
        fontSize: 16,
        height: 1.45,
        color: textPrimary,
      ),
      bodyMedium: TextStyle(
        fontSize: 14,
        height: 1.45,
        color: textMuted,
      ),
      bodySmall: TextStyle(
        fontSize: 12,
        color: textMuted,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: Color(0xFFD5DFEA)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: Color(0xFFD5DFEA)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: brandBlue, width: 1.4),
      ),
      hintStyle: const TextStyle(color: textMuted),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: brandBlue,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(56),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
        ),
        textStyle: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}
