package dev.fouruthent.agentremote

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class GuideAction { None, OpenConnect, Connect, OpenNewSession }

data class GuideStep(
    val title: String,
    val detail: String,
    val done: Boolean,
    val current: Boolean,
)

data class GuideContent(
    val stage: String,
    val stepNumber: Int,
    val totalSteps: Int,
    val title: String,
    val message: String,
    val bullets: List<String>,
    val code: String?,
    val action: GuideAction,
    val actionLabel: String?,
    val steps: List<GuideStep>,
)

fun guideFor(state: UiState): GuideContent {
    val connected = state.connection == ConnectionState.Connected
    val hasUrl = state.serverUrl.isNotBlank()
    val hasToken = state.token.isNotBlank()
    val hasSession = state.sessions.isNotEmpty() || state.currentSession != null
    val hasApproval = state.activeApproval != null
    val sessionError = state.currentSession?.status == "error"

    val stepNumber = when {
        hasApproval -> 5
        connected && sessionError -> 5
        connected && (state.route == Route.Timeline) -> 5
        connected -> 4
        state.connection == ConnectionState.Connecting -> 3
        state.connection == ConnectionState.Failed -> 3
        !hasUrl -> 1
        !hasToken -> 2
        else -> 3
    }

    val steps = listOf(
        GuideStep(
            "Macでagentdを起動",
            "ターミナルに接続先とQRが出ます",
            hasUrl || hasToken || connected,
            stepNumber == 1,
        ),
        GuideStep(
            "QRをスキャン、または接続先を入力",
            "ホストURLを貼り付け",
            hasUrl || connected,
            stepNumber == 2,
        ),
        GuideStep(
            "トークンを入力",
            "QRなら自動入力",
            hasToken || connected,
            stepNumber == 3,
        ),
        GuideStep(
            "接続する",
            "「接続」をタップ",
            connected,
            stepNumber == 4,
        ),
        GuideStep(
            "セッション開始・承認",
            "ランタイムを選んで実行",
            hasSession,
            stepNumber == 5,
        ),
    )

    return when {
        hasApproval -> GuideContent(
            stage = "承認待ち",
            stepNumber = 5,
            totalSteps = 5,
            title = "承認内容を確認してください",
            message = "エージェントがサンドボックス外の操作を要求しています。コマンド・作業ディレクトリ・理由を確認し、必要なら「一度だけ許可」を押します。",
            bullets = listOf(
                "「danger-full-access」は特に慎重に確認してください",
                "不要なら「拒否」で止められます",
                "許可は1回限りです。毎回確認されます",
            ),
            code = null,
            action = GuideAction.None,
            actionLabel = null,
            steps = steps,
        )
        sessionError -> GuideContent(
            stage = "セッションエラー",
            stepNumber = 5,
            totalSteps = 5,
            title = "セッションでエラーが発生しました",
            message = "接続はできています。選んだランタイムのログインや設定を確認してください。",
            bullets = listOf(
                "Claude: claude auth login または ANTHROPIC_API_KEY",
                "Codex: codex login status が ChatGPT ログインか確認",
                "DSH: DeepSeek Harness にログインしているか確認",
            ),
            code = null,
            action = GuideAction.None,
            actionLabel = null,
            steps = steps,
        )
        connected && state.route == Route.Timeline -> GuideContent(
            stage = "接続済み",
            stepNumber = 5,
            totalSteps = 5,
            title = "セッションを操作できます",
            message = "応答はリアルタイムで流れます。承認が出たら内容を確認してから許可してください。",
            bullets = listOf(
                "停止は入力欄右の赤い停止ボタン",
                "モデルは画面上部のモデルメニューから変更",
                "セッションを閉じる場合は右上の ×",
            ),
            code = null,
            action = GuideAction.None,
            actionLabel = null,
            steps = steps,
        )
        connected && state.sessions.isEmpty() -> GuideContent(
            stage = "接続済み",
            stepNumber = 4,
            totalSteps = 5,
            title = "接続できました。次はセッションを作成",
            message = "右上の鉛筆ボタンから新しいセッションを作り、DeepSeek Harness / Codex / Claude Code を選びます。",
            bullets = listOf(
                "作業ディレクトリはMac上のパス（例: ~/Documents/project）",
                "ランタイムごとにログインが必要です",
                "作成すると自動でタイムラインが開きます",
            ),
            code = null,
            action = GuideAction.OpenNewSession,
            actionLabel = "新規セッションを作る",
            steps = steps,
        )
        connected -> GuideContent(
            stage = "接続済み",
            stepNumber = 4,
            totalSteps = 5,
            title = "準備完了。セッションを開きましょう",
            message = "一覧からセッションを選ぶと、思考・ツール・コマンド出力・承認が表示されます。",
            bullets = listOf(
                "新規作成は右上の鉛筆ボタン",
                "承認は「一度だけ許可」または「拒否」",
                "コードやログは長押しでコピーできます",
            ),
            code = null,
            action = GuideAction.None,
            actionLabel = null,
            steps = steps,
        )
        state.connection == ConnectionState.Connecting -> GuideContent(
            stage = "接続中",
            stepNumber = 3,
            totalSteps = 5,
            title = "接続しています…",
            message = "agentdに接続中です。数秒待っても変わらない場合は、URLとトークンを確認してください。",
            bullets = listOf(
                "Mac側でagentdが起動しているか",
                "同じWi-Fi / Tailscaleに入っているか",
                "URLが ws://IP:8787/ws の形式か",
            ),
            code = "curl http://<MacのIP>:8787/health",
            action = GuideAction.None,
            actionLabel = null,
            steps = steps,
        )
        state.connection == ConnectionState.Failed -> GuideContent(
            stage = "接続エラー",
            stepNumber = 3,
            totalSteps = 5,
            title = "agentdに接続できませんでした",
            message = "ホストURL・トークン・ネットワークを確認してください。",
            bullets = listOf(
                "MacとAndroidが同じWi-Fi、または両方Tailscaleに入っているか",
                "Androidから 127.0.0.1 は使えません（端末自身を指します）",
                "URLはagentdの WebSocket: 行をそのまま貼り付け",
                "Macのファイアウォールで8787が許可されているか",
            ),
            code = "curl http://<MacのIP>:8787/health",
            action = GuideAction.OpenConnect,
            actionLabel = "接続画面に戻る",
            steps = steps,
        )
        !hasUrl -> GuideContent(
            stage = "はじめに",
            stepNumber = 1,
            totalSteps = 5,
            title = "まずMacでagentdを起動します",
            message = "Macのターミナルでagentdを起動すると、接続先URL・トークン・QRコードが表示されます。",
            bullets = listOf(
                "ターミナルの WebSocket: の行がホストURLです",
                "実機はMacと同じWi-Fi、またはTailscaleで接続",
                "Androidの 127.0.0.1 はAndroid自身なので使いません",
            ),
            code = "cd agentd\nnpm start",
            action = GuideAction.None,
            actionLabel = null,
            steps = steps,
        )
        !hasToken -> GuideContent(
            stage = "接続情報",
            stepNumber = 2,
            totalSteps = 5,
            title = "QRコードをスキャンするのが一番簡単です",
            message = "agentdのターミナルに出ているQRコードを読み取ると、ホストURLとトークンが自動で入ります。",
            bullets = listOf(
                "QRが使えない場合: agentdの Token: の行をトークン欄に貼り付け",
                "トークンは cat ~/.agent-remote/token でも確認できます",
                "ホストURLは ws://...:8787/ws の形式です",
            ),
            code = "cat ~/.agent-remote/token",
            action = GuideAction.OpenConnect,
            actionLabel = "接続画面に戻る",
            steps = steps,
        )
        else -> GuideContent(
            stage = "接続準備完了",
            stepNumber = 3,
            totalSteps = 5,
            title = "「接続」を押してください",
            message = "ホストURLとトークンが入力されています。接続ボタンを押すとセッション一覧に進みます。",
            bullets = listOf(
                "接続できない場合はガイドのトラブル項目を確認",
                "接続後は右上の鉛筆からセッションを作成",
                "承認はセッション画面に表示されます",
            ),
            code = null,
            action = GuideAction.Connect,
            actionLabel = "接続する",
            steps = steps,
        )
    }
}

@Composable
fun HelpButton(onClick: () -> Unit, highlight: Boolean = false) {
    Box(contentAlignment = Alignment.TopEnd) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier.size(40.dp),
        ) {
            Box(Modifier.clickable(onClick = onClick), contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Outlined.HelpOutline,
                    contentDescription = "セットアップガイド",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        if (highlight) {
            Box(
                Modifier
                    .size(9.dp)
                    .clip(CircleShape)
                    .background(Palette.Orange),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GuideSheet(
    state: UiState,
    onDismiss: () -> Unit,
    onAction: (GuideAction) -> Unit,
) {
    val content = guideFor(state)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.background,
        dragHandle = {
            Box(
                Modifier
                    .padding(top = 10.dp)
                    .size(width = 36.dp, height = 4.dp)
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
            )
        },
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.HelpOutline, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(19.dp))
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("セットアップガイド", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "${content.stage} · ステップ ${content.stepNumber} / ${content.totalSteps}",
                        fontSize = 11.sp,
                        color = Palette.Secondary,
                    )
                }
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = "閉じる",
                    tint = Palette.Secondary,
                    modifier = Modifier
                        .size(22.dp)
                        .clickable(onClick = onDismiss),
                )
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                repeat(content.totalSteps) { index ->
                    Box(
                        Modifier
                            .weight(1f)
                            .height(3.dp)
                            .clip(RoundedCornerShape(50))
                            .background(
                                if (index < content.stepNumber) Palette.Blue
                                else MaterialTheme.colorScheme.outline.copy(alpha = 0.35f)
                            ),
                    )
                }
            }
            Spacer(Modifier.height(22.dp))
            Text(content.title, fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 28.sp)
            Spacer(Modifier.height(8.dp))
            Text(
                content.message,
                fontSize = 14.sp,
                lineHeight = 21.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (content.bullets.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    content.bullets.forEach { bullet ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("•", color = Palette.Blue, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            Text(bullet, fontSize = 13.sp, lineHeight = 19.sp)
                        }
                    }
                }
            }
            content.code?.let {
                Spacer(Modifier.height(14.dp))
                CodeBlock(it, label = "ターミナル")
            }
            if (content.action != GuideAction.None && content.actionLabel != null) {
                Spacer(Modifier.height(18.dp))
                Button(
                    onClick = { onAction(content.action) },
                    modifier = Modifier.fillMaxWidth().height(46.dp),
                    shape = RoundedCornerShape(13.dp),
                ) {
                    Text(content.actionLabel, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Spacer(Modifier.height(18.dp))
            HorizontalDivider()
            Spacer(Modifier.height(14.dp))
            Text("手順の全体", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.Secondary)
            Spacer(Modifier.height(8.dp))
            content.steps.forEach { step ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        if (step.done) Icons.Outlined.Check else Icons.Outlined.RadioButtonUnchecked,
                        contentDescription = null,
                        tint = if (step.done) Palette.Green else if (step.current) Palette.Blue else Palette.Tertiary,
                        modifier = Modifier.size(18.dp).padding(top = 1.dp),
                    )
                    Column(Modifier.weight(1f)) {
                        Text(
                            step.title,
                            fontSize = 13.sp,
                            fontWeight = if (step.current) FontWeight.SemiBold else FontWeight.Normal,
                            color = if (step.current) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(step.detail, fontSize = 11.sp, color = Palette.Secondary)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "QRは agentd のターミナルに表示されます。うまくいかない場合は agentd のログと、Mac・Androidのネットワークを確認してください。",
                fontSize = 11.sp,
                lineHeight = 16.sp,
                color = Palette.Secondary,
            )
            Spacer(Modifier.height(6.dp))
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text("閉じる", fontSize = 15.sp)
            }
        }
    }
}
