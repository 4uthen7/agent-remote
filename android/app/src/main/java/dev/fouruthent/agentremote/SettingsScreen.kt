package dev.fouruthent.agentremote

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.CircleShape
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.background

@Composable
fun SettingsScreen(state: UiState, store: AgentStore, appLock: AppLock) {
    var showDisconnect by remember { mutableStateOf(false) }
    var showLockSetup by remember { mutableStateOf(false) }
    var showLockDisable by remember { mutableStateOf(false) }
    var lockPassword by remember { mutableStateOf("") }
    var lockConfirmation by remember { mutableStateOf("") }
    var lockError by remember { mutableStateOf<String?>(null) }
    val lockState by appLock.state.collectAsStateWithLifecycle()
    BackHandler { store.back() }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(top = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier
                    .size(40.dp)
                    .background(MaterialTheme.colorScheme.surface, CircleShape)
                    .clickable(onClick = store::back),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Icon(Icons.Outlined.ArrowBack, "戻る", tint = Palette.Blue, modifier = Modifier.size(19.dp))
            }
            Spacer(Modifier.weight(1f))
            Text("設定", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.width(40.dp))
        }
        Spacer(Modifier.height(16.dp))

        SectionLabel("ランタイム")
        GroupCard {
            listOf(
                "dsh" to "DeepSeek Harness",
                "codex" to "Codex",
                "claude" to "Claude Code",
            ).forEachIndexed { index, (id, title) ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { store.setRuntime(id) }
                        .padding(horizontal = 14.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(title, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    if (state.selectedRuntime == id) {
                        Icon(Icons.Outlined.Check, null, tint = Palette.Blue, modifier = Modifier.size(18.dp))
                    }
                }
                if (index != 2) GroupDivider()
            }
        }
        Text(
            "新規セッションのデフォルトです。",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, top = 8.dp),
        )
        Spacer(Modifier.height(24.dp))

        SectionLabel("接続情報")
        GroupCard {
            InfoRow("ホスト", state.host.ifBlank { "—" })
            GroupDivider()
            InfoRow("URL", state.serverUrl)
            GroupDivider()
            InfoRow("バージョン", state.version.ifBlank { "—" })
            GroupDivider()
            InfoRow("セッション", "${state.sessions.size} 件")
        }
        Spacer(Modifier.height(24.dp))

        SectionLabel("アプリロック")
        GroupCard {
            if (!lockState.enabled) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable {
                            lockPassword = ""
                            lockConfirmation = ""
                            lockError = null
                            showLockSetup = true
                        }
                        .padding(horizontal = 14.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(Icons.Outlined.Lock, null, tint = Palette.Blue, modifier = Modifier.size(19.dp))
                    Column(Modifier.weight(1f)) {
                        Text("アプリロックを有効にする", fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        Text(
                            "起動時・バックグラウンド復帰時に生体認証またはアプリパスワードで解除",
                            fontSize = 11.sp,
                            color = Palette.Secondary,
                            lineHeight = 16.sp,
                        )
                    }
                    Icon(Icons.Outlined.ChevronRight, null, tint = Palette.Tertiary, modifier = Modifier.size(16.dp))
                }
            } else {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Lock, null, tint = Palette.Green, modifier = Modifier.size(18.dp))
                    Text("アプリロック", fontSize = 14.sp, modifier = Modifier.weight(1f).padding(start = 10.dp))
                    Text("有効", fontSize = 13.sp, color = Palette.Green, fontWeight = FontWeight.SemiBold)
                }
                GroupDivider()
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Fingerprint, null, tint = Palette.Blue, modifier = Modifier.size(19.dp))
                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                        Text("生体認証を使う", fontSize = 14.sp)
                        Text(
                            if (lockState.biometricAvailable) "${lockState.biometricLabel}で解除できます"
                            else "この端末では生体認証を利用できません",
                            fontSize = 11.sp,
                            color = Palette.Secondary,
                        )
                    }
                    Switch(
                        checked = lockState.biometricEnabled,
                        onCheckedChange = { appLock.setBiometricEnabled(it) },
                        enabled = lockState.biometricAvailable,
                    )
                }
                GroupDivider()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable {
                            lockPassword = ""
                            lockConfirmation = ""
                            lockError = null
                            showLockSetup = true
                        }
                        .padding(horizontal = 14.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("アプリパスワードを変更", fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Icon(Icons.Outlined.ChevronRight, null, tint = Palette.Tertiary, modifier = Modifier.size(16.dp))
                }
                GroupDivider()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { showLockDisable = true }
                        .padding(horizontal = 14.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("アプリロックを無効にする", fontSize = 14.sp, color = Palette.Red, modifier = Modifier.weight(1f))
                }
            }
        }
        Text(
            "アプリパスワードは6文字以上。忘れた場合の復旧はありません。",
            fontSize = 11.sp,
            lineHeight = 16.sp,
            color = Palette.Secondary,
            modifier = Modifier.padding(start = 4.dp, top = 8.dp),
        )
        Spacer(Modifier.height(24.dp))

        SectionLabel("セキュリティ")
        GroupCard {
            Row(
                Modifier.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.Outlined.Shield, null, tint = Palette.Green, modifier = Modifier.size(18.dp))
                Text(
                    "トークンは Android Keystore で暗号化して保存されます。承認はワンショットで、danger-full-access は明示的に表示されます。",
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(24.dp))

        TextButton(
            onClick = { showDisconnect = true },
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) {
            Text("切断", color = Palette.Red, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "Agent Remote for Android · v${state.version.ifBlank { "0.5.0" }}\nDSH / Codex / Claude",
            fontSize = 11.sp,
            color = Palette.Secondary,
            lineHeight = 17.sp,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(40.dp))
    }

    if (showLockSetup) {
        AlertDialog(
            onDismissRequest = { showLockSetup = false },
            title = { Text(if (lockState.enabled) "アプリパスワードを変更" else "アプリロックを有効にする") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "6文字以上のアプリパスワードを設定します。",
                        fontSize = 12.sp,
                        color = Palette.Secondary,
                    )
                    OutlinedTextField(
                        value = lockPassword,
                        onValueChange = { lockPassword = it; lockError = null },
                        label = { Text("新しいアプリパスワード") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    OutlinedTextField(
                        value = lockConfirmation,
                        onValueChange = { lockConfirmation = it; lockError = null },
                        label = { Text("確認のためもう一度") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    if (lockError != null) {
                        Text(lockError ?: "", fontSize = 12.sp, color = Palette.Red)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = lockPassword.length >= 6 && lockPassword == lockConfirmation,
                    onClick = {
                        runCatching { appLock.enable(lockPassword) }
                            .onSuccess { showLockSetup = false }
                            .onFailure { lockError = it.message ?: "保存できませんでした。" }
                    },
                ) { Text("保存") }
            },
            dismissButton = {
                TextButton(onClick = { showLockSetup = false }) { Text("キャンセル") }
            },
        )
    }

    if (showLockDisable) {
        AlertDialog(
            onDismissRequest = { showLockDisable = false },
            title = { Text("アプリロックを無効にしますか？") },
            text = { Text("次回から生体認証とアプリパスワードの画面は表示されません。") },
            confirmButton = {
                TextButton(onClick = {
                    showLockDisable = false
                    appLock.disable()
                }) { Text("無効にする", color = Palette.Red) }
            },
            dismissButton = { TextButton(onClick = { showLockDisable = false }) { Text("キャンセル") } },
        )
    }

    if (showDisconnect) {
        AlertDialog(
            onDismissRequest = { showDisconnect = false },
            title = { Text("切断しますか？") },
            text = { Text("保存済みのURLとトークンは残ります。") },
            confirmButton = {
                TextButton(onClick = {
                    showDisconnect = false
                    store.disconnect()
                }) { Text("切断", color = Palette.Red) }
            },
            dismissButton = { TextButton(onClick = { showDisconnect = false }) { Text("キャンセル") } },
        )
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(88.dp))
        Text(value, fontSize = 13.sp, modifier = Modifier.weight(1f), maxLines = 2)
    }
}
