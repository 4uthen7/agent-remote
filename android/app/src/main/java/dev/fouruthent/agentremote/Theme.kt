package dev.fouruthent.agentremote

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object Palette {
    val Blue = Color(0xFF0A84FF)
    val BlueDark = Color(0xFF409CFF)
    val Green = Color(0xFF34C759)
    val Orange = Color(0xFFFF9F0A)
    val Red = Color(0xFFFF3B30)
    val Background = Color(0xFFF2F2F7)
    val Card = Color(0xFFFFFFFF)
    val Secondary = Color(0xFF8E8E93)
    val Tertiary = Color(0xFFC7C7CC)
    val Divider = Color(0xFFE5E5EA)
    val DarkBackground = Color(0xFF000000)
    val DarkCard = Color(0xFF1C1C1E)
    val DarkDivider = Color(0xFF38383A)
    val CodeBackground = Color(0xFFF2F2F7)
    val DarkCodeBackground = Color(0xFF2C2C2E)
    val OrangeTint = Color(0xFFFFF4E5)
    val DarkOrangeTint = Color(0xFF3A2A12)
    val RedTint = Color(0xFFFFECEB)
    val DarkRedTint = Color(0xFF3A1A1A)
}

@Composable
fun AgentTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (dark) {
        darkColorScheme(
            primary = Palette.BlueDark,
            onPrimary = Color.White,
            background = Palette.DarkBackground,
            onBackground = Color.White,
            surface = Palette.DarkCard,
            onSurface = Color.White,
            surfaceVariant = Palette.DarkCodeBackground,
            onSurfaceVariant = Color(0xFFEBEBF5),
            outline = Palette.DarkDivider,
            error = Palette.Red,
        )
    } else {
        lightColorScheme(
            primary = Palette.Blue,
            onPrimary = Color.White,
            background = Palette.Background,
            onBackground = Color.Black,
            surface = Palette.Card,
            onSurface = Color.Black,
            surfaceVariant = Palette.CodeBackground,
            onSurfaceVariant = Color(0xFF3C3C43),
            outline = Palette.Divider,
            error = Palette.Red,
        )
    }
    MaterialTheme(
        colorScheme = colors,
        typography = Typography(),
        content = content,
    )
}
