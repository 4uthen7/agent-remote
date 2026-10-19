package dev.fouruthent.agentremote

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Handyman
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Canvas

@Composable
fun TerminalMark(size: Dp = 64.dp) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.28f))
            .background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.Terminal,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(size * 0.42f),
        )
    }
}

fun statusColor(status: String): Color = when (status) {
    "running" -> Palette.Blue
    "awaiting_approval" -> Palette.Orange
    "error" -> Palette.Red
    "archived" -> Palette.Secondary
    else -> Palette.Secondary
}

fun runtimeColor(runtime: String): Color = when (runtime) {
    "codex" -> Palette.Green
    "claude" -> Palette.Orange
    else -> Palette.Blue
}

@Composable
fun StatusDot(status: String, size: Dp = 7.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(statusColor(status)))
}

@Composable
fun RuntimeText(runtime: String, uppercase: Boolean = false) {
    Text(
        text = if (uppercase) runtime.uppercase() else when (runtime) {
            "codex" -> "Codex"
            "claude" -> "Claude"
            else -> "DeepSeek"
        },
        color = runtimeColor(runtime),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
fun StatusPill(status: String) {
    val color = statusColor(status)
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        StatusDot(status, 6.dp)
        Text(
            text = when (status) {
                "running" -> "実行中"
                "awaiting_approval" -> "承認待ち"
                "error" -> "エラー"
                "archived" -> "終了"
                else -> "待機中"
            },
            color = color,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.72f),
        modifier = modifier.padding(start = 4.dp, bottom = 8.dp),
    )
}

@Composable
fun GroupCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(content = content)
    }
}

@Composable
fun GroupDivider(leading: Dp = 16.dp) {
    HorizontalDivider(
        modifier = Modifier.padding(start = leading),
        thickness = 0.5.dp,
        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.65f),
    )
}

@Composable
fun RoundIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    tint: Color = MaterialTheme.colorScheme.primary,
) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.size(40.dp),
    ) {
        IconButton(onClick = onClick, modifier = Modifier.size(40.dp)) {
            Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(19.dp))
        }
    }
}

fun copyToClipboard(context: Context, text: String, label: String = "コピーしました") {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Agent Remote", text))
    Toast.makeText(context, label, Toast.LENGTH_SHORT).show()
}

fun readClipboard(context: Context): String {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = clipboard.primaryClip ?: return ""
    if (clip.itemCount == 0) return ""
    return clip.getItemAt(0).coerceToText(context).toString()
}

@Composable
fun CodeBlock(text: String, label: String? = null, accent: Color = MaterialTheme.colorScheme.primary) {
    val context = LocalContext.current
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (label != null) {
                    Text(
                        label,
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    Spacer(Modifier.weight(1f))
                }
                Icon(
                    Icons.Outlined.ContentCopy,
                    contentDescription = "コピー",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    modifier = Modifier
                        .size(16.dp)
                        .clickable { copyToClipboard(context, text) },
                )
            }
            Spacer(Modifier.height(4.dp))
            SelectionContainer {
                Text(
                    text = text,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                )
            }
        }
    }
}

@Composable
fun ContextBadge(fraction: Double) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Canvas(Modifier.size(20.dp)) {
            val stroke = 2.5.dp.toPx()
            drawCircle(
                color = Palette.Secondary.copy(alpha = 0.22f),
                style = Stroke(width = stroke),
                radius = size.minDimension / 2 - stroke / 2,
            )
            if (fraction > 0.0) {
                drawArc(
                    color = Palette.Blue,
                    startAngle = -90f,
                    sweepAngle = (fraction.coerceIn(0.0, 1.0) * 360f).toFloat(),
                    useCenter = false,
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
        }
        Text(
            "コンテキスト ${Json.contextText(fraction)}",
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.72f),
            maxLines = 1,
            softWrap = false,
        )
    }
}

@Composable
fun UserBubble(text: String) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Box(
            Modifier
                .widthIn(max = 320.dp)
                .clip(RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp))
                .background(MaterialTheme.colorScheme.primary)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(text, color = Color.White, fontSize = 15.sp, lineHeight = 21.sp)
        }
    }
}

@Composable
fun AssistantRow(text: String, streaming: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            Modifier
                .padding(top = 2.dp)
                .size(24.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.AutoAwesome,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(14.dp),
            )
        }
        SelectionContainer {
            Text(
                text = text + if (streaming) " ▍" else "",
                fontSize = 15.sp,
                lineHeight = 23.sp,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
fun ThoughtCard(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Outlined.AutoAwesome, null, tint = Palette.Secondary, modifier = Modifier.size(13.dp))
                Text("思考", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Palette.Secondary)
            }
            Text(
                text = text,
                fontSize = 13.sp,
                lineHeight = 19.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun ToolCard(item: TimelineItem) {
    val status = item.status ?: "in_progress"
    val color = when (status) {
        "completed" -> Palette.Green
        "failed", "declined" -> Palette.Red
        else -> Palette.Blue
    }
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier
            .fillMaxWidth()
            .border(0.5.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f), RoundedCornerShape(14.dp)),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.Handyman, null, tint = color, modifier = Modifier.size(16.dp))
                Text(
                    item.title ?: "tool",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = when (status) {
                        "completed" -> "完了"
                        "failed" -> "失敗"
                        "declined" -> "拒否"
                        else -> "実行中"
                    },
                    color = color,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                )
                if (status == "in_progress") CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
            }
            item.command?.takeIf { it.isNotBlank() }?.let { CodeBlock(it, label = "コマンド") }
            item.cwd?.takeIf { it.isNotBlank() }?.let {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Outlined.Folder, null, tint = Palette.Secondary, modifier = Modifier.size(12.dp))
                    Text(it, fontSize = 11.sp, color = Palette.Secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            item.output?.takeIf { it.isNotBlank() }?.let {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("出力", fontSize = 10.sp, color = Palette.Secondary)
                    CodeBlock(it, label = null)
                }
            }
        }
    }
}

@Composable
fun NoticeRow(text: String) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Text(text, fontSize = 12.sp, color = Palette.Secondary)
    }
}

@Composable
fun ErrorCard(text: String) {
    Surface(
        color = Palette.Red.copy(alpha = 0.09f),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(0.5.dp, Palette.Red.copy(alpha = 0.35f), RoundedCornerShape(14.dp)),
    ) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Outlined.ErrorOutline, null, tint = Palette.Red, modifier = Modifier.size(18.dp))
            SelectionContainer {
                Text(text, fontSize = 13.sp, lineHeight = 19.sp, color = Palette.Red)
            }
        }
    }
}

@Composable
fun ApprovalCard(approval: Approval, onApprove: (Approval, String) -> Unit) {
    val accent = if (approval.isDangerous) Palette.Red else Palette.Orange
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, accent.copy(alpha = 0.5f), RoundedCornerShape(16.dp)),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.ErrorOutline, null, tint = accent, modifier = Modifier.size(18.dp))
                Text("承認が必要です", color = accent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                Text(approval.title, fontSize = 11.sp, color = Palette.Secondary, maxLines = 1)
            }
            if (approval.isDangerous) {
                Text(
                    "危険: この操作はサンドボックス外で実行されます",
                    color = Palette.Red,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            approval.justification?.takeIf { it.isNotBlank() }?.let {
                Text(it, fontSize = 13.sp, lineHeight = 19.sp)
            }
            approval.command?.takeIf { it.isNotBlank() }?.let { CodeBlock(it, label = "コマンド", accent = accent) }
            approval.cwd?.takeIf { it.isNotBlank() }?.let {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Outlined.Folder, null, tint = Palette.Secondary, modifier = Modifier.size(12.dp))
                    Text(it, fontSize = 11.sp, color = Palette.Secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                approval.options.forEach { option ->
                    if (option.isDestructive) {
                        OutlinedButton(
                            onClick = { onApprove(approval, option.optionId) },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.Red),
                        ) { Text(option.label) }
                    } else {
                        Button(
                            onClick = { onApprove(approval, option.optionId) },
                            modifier = Modifier.weight(1f),
                        ) { Text(option.label) }
                    }
                }
            }
        }
    }
}

@Composable
fun ChatInput(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    onCancel: () -> Unit,
    busy: Boolean,
    enabled: Boolean,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(0.5.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f), RoundedCornerShape(24.dp)),
    ) {
        Row(
            Modifier.padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                textStyle = TextStyle(
                    fontSize = 15.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                maxLines = 5,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 10.dp),
                decorationBox = { inner ->
                    if (value.isBlank()) {
                        Text("メッセージ", color = Palette.Secondary, fontSize = 15.sp)
                    }
                    inner()
                },
            )
            Spacer(Modifier.width(6.dp))
            if (busy) {
                IconButton(
                    onClick = onCancel,
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(Palette.Red),
                ) {
                    Icon(Icons.Outlined.Stop, "停止", tint = Color.White, modifier = Modifier.size(17.dp))
                }
            } else {
                IconButton(
                    onClick = onSend,
                    enabled = enabled && value.isNotBlank(),
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(if (enabled && value.isNotBlank()) Palette.Blue else Palette.Tertiary),
                ) {
                    Icon(Icons.Outlined.ArrowUpward, "送信", tint = Color.White, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
fun EmptyState(title: String, description: String) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 48.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        TerminalMark(52.dp)
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        Text(
            description,
            fontSize = 13.sp,
            color = Palette.Secondary,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            lineHeight = 19.sp,
        )
    }
}

@Composable
fun DividerLine() {
    HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outline.copy(alpha = 0.6f))
}
