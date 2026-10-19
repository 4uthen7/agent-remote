package dev.fouruthent.agentremote

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun TimelineScreen(state: UiState, store: AgentStore, onHelp: () -> Unit) {
    val session = state.currentSession
    val items = state.timeline
    val listState = rememberLazyListState()
    var draft by remember { mutableStateOf("") }
    var modelExpanded by remember { mutableStateOf(false) }
    var showClose by remember { mutableStateOf(false) }
    BackHandler { store.back() }

    LaunchedEffect(items.size, items.lastOrNull()?.text?.length) {
        if (items.isNotEmpty()) {
            runCatching { listState.scrollToItem(items.lastIndex) }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .imePadding(),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 8.dp, top = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .background(MaterialTheme.colorScheme.surface, CircleShape)
                    .clickable(onClick = store::back),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.ArrowBack, "戻る", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(19.dp))
            }
            Spacer(Modifier.weight(1f))
            Text("セッション", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Box {
                Row(
                    Modifier
                        .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(50))
                        .clickable(enabled = state.modelOption != null) { modelExpanded = true }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(Icons.Outlined.Memory, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(15.dp))
                    Text(
                        state.modelLabel,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.width(120.dp),
                    )
                    Icon(Icons.Outlined.KeyboardArrowDown, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(14.dp))
                }
                DropdownMenu(expanded = modelExpanded, onDismissRequest = { modelExpanded = false }) {
                    state.modelOption?.flatValues?.forEach { value ->
                        DropdownMenuItem(
                            text = { Text(value.name, fontSize = 14.sp) },
                            trailingIcon = {
                                if (value.value == state.modelOption?.currentValue) Text("✓", color = Palette.Blue)
                            },
                            onClick = {
                                modelExpanded = false
                                store.setModel(value.value)
                            },
                        )
                    }
                }
            }
            IconButton(onClick = onHelp) {
                Icon(Icons.Outlined.HelpOutline, "セットアップガイド", tint = Palette.Secondary, modifier = Modifier.size(18.dp))
            }
            IconButton(onClick = { showClose = true }) {
                Icon(Icons.Outlined.Close, "セッションを閉じる", tint = Palette.Secondary, modifier = Modifier.size(18.dp))
            }
        }

        if (session == null) {
            EmptyState("セッションがありません", "セッション一覧に戻ってください。")
            return@Column
        }

        if (session.archived) {
            ArchivedSessionBanner(
                resumable = session.resumable,
                originHost = session.originHost,
                onResume = { store.resumeSession(session) },
            )
        }

        Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                session.title,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                StatusPill(if (session.archived) "archived" else session.status)
                RuntimeText(session.runtime)
                Text(
                    session.displayModel,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                ContextBadge(state.contextFraction)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(Icons.Outlined.Folder, null, tint = Palette.Secondary, modifier = Modifier.size(12.dp))
                Text(
                    session.cwd,
                    fontSize = 11.sp,
                    color = Palette.Secondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (items.isEmpty()) {
                item {
                    Text(
                        "下の入力欄からメッセージを送信します。",
                        fontSize = 13.sp,
                        color = Palette.Secondary,
                        modifier = Modifier.padding(top = 40.dp),
                    )
                }
            }
            items(items, key = { it.id }) { item ->
                when (item.kind) {
                    TimelineKind.User -> UserBubble(item.text)
                    TimelineKind.Assistant -> AssistantRow(item.text, item.streaming)
                    TimelineKind.Thought -> ThoughtCard(item.text)
                    TimelineKind.Tool -> ToolCard(item)
                    TimelineKind.Notice -> NoticeRow(item.text)
                    TimelineKind.Error -> ErrorCard(item.text)
                }
            }
        }

        Column(
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.background)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            state.activeApproval?.let { approval ->
                ApprovalCard(approval) { item, option -> store.approve(item, option) }
            }
            ChatInput(
                value = draft,
                onValueChange = { draft = it },
                onSend = {
                    if (draft.isNotBlank()) {
                        store.sendPrompt(draft)
                        draft = ""
                    }
                },
                onCancel = store::cancel,
                busy = session.isRunning,
                enabled = state.isConnected && state.activeApproval == null && !session.archived,
            )
        }
    }

    if (showClose) {
        AlertDialog(
            onDismissRequest = { showClose = false },
            title = { Text("セッションを閉じますか？") },
            text = { Text("agentd 側のセッションを閉じます。") },
            confirmButton = {
                TextButton(onClick = {
                    showClose = false
                    store.closeCurrentSession()
                }) { Text("閉じる", color = Palette.Red) }
            },
            dismissButton = { TextButton(onClick = { showClose = false }) { Text("キャンセル") } },
        )
    }
}


@Composable
private fun ArchivedSessionBanner(
    resumable: Boolean,
    originHost: String?,
    onResume: () -> Unit,
) {
    Surface(
        color = Palette.Blue.copy(alpha = 0.09f),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Icon(Icons.Outlined.Archive, null, tint = Palette.Blue, modifier = Modifier.size(18.dp))
            Column(Modifier.weight(1f)) {
                Text("終了したセッション", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    if (resumable) "履歴を表示中。再開すると続きから話せます。"
                    else "この履歴は ${originHost ?: "別のホスト"} のものです。",
                    fontSize = 10.sp,
                    color = Palette.Secondary,
                    lineHeight = 14.sp,
                )
            }
            if (resumable) {
                TextButton(onClick = onResume) {
                    Text("再開", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
