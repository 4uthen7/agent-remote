package dev.fouruthent.agentremote

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun SessionsScreen(state: UiState, store: AgentStore, onHelp: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 12.dp, top = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HelpButton(onClick = onHelp, highlight = state.sessions.isEmpty())
            Spacer(Modifier.weight(1f))
            IconButton(onClick = store::refreshSessions) {
                Icon(Icons.Outlined.Refresh, "更新", tint = Palette.Secondary)
            }
            IconButton(onClick = store::openNewSession) {
                Icon(Icons.Outlined.Edit, "新規セッション", tint = MaterialTheme.colorScheme.primary)
            }
            IconButton(onClick = store::openSettings) {
                Icon(Icons.Outlined.Settings, "設定", tint = MaterialTheme.colorScheme.primary)
            }
        }
        Text(
            "セッション",
            fontSize = 34.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.6).sp,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
        )
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            item {
                HostCard(state)
            }
            item { SectionLabel("最近のセッション") }
            if (state.sessions.isEmpty()) {
                item {
                    EmptyState(
                        "セッションがありません",
                        "PC 上の DSH / Codex / Claude で新しいセッションを開始します。",
                    )
                }
            } else {
                item {
                    GroupCard {
                        state.sessions.forEachIndexed { index, session ->
                            SessionRow(session) { store.openSession(session) }
                            if (index != state.sessions.lastIndex) GroupDivider(leading = 64.dp)
                        }
                    }
                }
            }
            item {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("LOCAL TRANSPORT · TAILSCALE READY", fontSize = 9.sp, color = Palette.Secondary, letterSpacing = 1.sp)
                    Text("·", fontSize = 9.sp, color = Palette.Tertiary)
                    Text("v${state.version.ifBlank { "0.3.2" }}", fontSize = 9.sp, color = Palette.Secondary)
                }
            }
        }
    }
}

@Composable
private fun HostCard(state: UiState) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier
                    .size(46.dp)
                    .clip(CircleShape)
                    .background(Palette.Green.copy(alpha = 0.13f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Terminal, null, tint = Palette.Green, modifier = Modifier.size(22.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(
                    state.host.ifBlank { "PC" },
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "DSH / Codex / Claude",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text("${state.sessions.size} 件", fontSize = 13.sp, color = Palette.Secondary)
        }
    }
}

@Composable
private fun SessionRow(session: SessionSummary, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val color = statusColor(session.status)
        Box(
            Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(color.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                when (session.status) {
                    "awaiting_approval" -> Icons.Outlined.PanTool
                    "error" -> Icons.Outlined.ErrorOutline
                    "running" -> Icons.Outlined.Bolt
                    else -> Icons.Outlined.Terminal
                },
                null,
                tint = color,
                modifier = Modifier.size(19.dp),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                session.title,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                session.cwd,
                fontSize = 11.sp,
                color = Palette.Secondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                StatusDot(session.status, 6.dp)
                Text(session.statusLabel, fontSize = 11.sp, color = Palette.Secondary)
                Text("·", fontSize = 11.sp, color = Palette.Tertiary)
                RuntimeText(session.runtime)
                Text("·", fontSize = 11.sp, color = Palette.Tertiary)
                Text(
                    session.displayModel,
                    fontSize = 11.sp,
                    color = Palette.Secondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    Json.relativeTime(session.updatedAt),
                    fontSize = 10.sp,
                    color = Palette.Tertiary,
                    maxLines = 1,
                )
            }
        }
        Icon(Icons.Outlined.ChevronRight, null, tint = Palette.Tertiary, modifier = Modifier.size(16.dp))
    }
}
