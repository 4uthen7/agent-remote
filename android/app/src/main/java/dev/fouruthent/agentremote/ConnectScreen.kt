package dev.fouruthent.agentremote

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

@Composable
fun ConnectScreen(state: UiState, store: AgentStore) {
    val context = LocalContext.current
    var showToken by remember { mutableStateOf(false) }
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (!contents.isNullOrBlank()) store.applyPairing(contents)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(48.dp))
        Text(
            "Agent Remote",
            fontSize = 34.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.6).sp,
        )
        Spacer(Modifier.height(22.dp))
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            TerminalMark(64.dp)
            Spacer(Modifier.height(12.dp))
            Text(
                "DSH・Codex・Claude をリモート操作",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(connectionColor(state.connection)),
                )
                Text(
                    connectionText(state.connection),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(30.dp))

        if (state.lastError != null) {
            ErrorCard(state.lastError)
            Spacer(Modifier.height(14.dp))
        }

        SectionLabel("接続情報")
        GroupCard {
            FieldRow(
                label = "ホスト",
                value = state.serverUrl,
                placeholder = "ws://192.168.x.x:8787/ws",
                keyboardType = KeyboardType.Uri,
                monospace = true,
                onValueChange = store::setServerUrl,
                trailing = {
                    IconButton(onClick = { store.setServerUrl(readClipboard(context)) }) {
                        Icon(Icons.Outlined.ContentPaste, "ホストを貼り付け", tint = Palette.Secondary)
                    }
                },
            )
            GroupDivider()
            FieldRow(
                label = "トークン",
                value = state.token,
                placeholder = "agentd のトークン",
                keyboardType = KeyboardType.Password,
                monospace = true,
                visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                onValueChange = store::setToken,
                trailing = {
                    IconButton(onClick = { showToken = !showToken }) {
                        Icon(
                            if (showToken) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            if (showToken) "トークンを隠す" else "トークンを表示",
                            tint = Palette.Secondary,
                        )
                    }
                    IconButton(onClick = { store.setToken(readClipboard(context)) }) {
                        Icon(Icons.Outlined.ContentPaste, "トークンを貼り付け", tint = Palette.Secondary)
                    }
                },
            )
        }
        Text(
            "agentd が表示する URL とトークンを入力します。QR コードを使うと自動で入力されます。",
            fontSize = 12.sp,
            lineHeight = 17.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
        )
        Button(
            onClick = store::connect,
            enabled = state.connection != ConnectionState.Connecting,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            if (state.connection == ConnectionState.Connecting) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
            Text("接続", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(10.dp))
        OutlinedButton(
            onClick = {
                val options = ScanOptions()
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt("QR コードをスキャン")
                    .setBeepEnabled(false)
                    .setOrientationLocked(true)
                scanLauncher.launch(options)
            },
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            Text("QR コードをスキャン", fontSize = 15.sp, fontWeight = FontWeight.Medium)
        }

        Spacer(Modifier.height(26.dp))
        SectionLabel("セキュリティ")
        GroupCard {
            Row(
                Modifier.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.Outlined.Shield, null, tint = Palette.Green, modifier = Modifier.size(18.dp))
                Text(
                    "トークンは Android Keystore で暗号化して保存されます。LAN 外から使う場合は Tailscale 経由で接続してください。",
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun FieldRow(
    label: String,
    value: String,
    placeholder: String,
    keyboardType: KeyboardType,
    monospace: Boolean,
    onValueChange: (String) -> Unit,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailing: @Composable (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(64.dp),
        )
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(
                fontSize = 14.sp,
                fontFamily = if (monospace) FontFamily.Monospace else FontFamily.Default,
                color = MaterialTheme.colorScheme.onSurface,
            ),
            keyboardOptions = KeyboardOptions(
                keyboardType = keyboardType,
                autoCorrectEnabled = false,
            ),
            visualTransformation = visualTransformation,
            modifier = Modifier.weight(1f),
            decorationBox = { inner ->
                if (value.isBlank()) {
                    Text(placeholder, fontSize = 14.sp, color = Palette.Secondary)
                }
                inner()
            },
        )
        Row(verticalAlignment = Alignment.CenterVertically) { trailing?.invoke() }
    }
}

fun connectionColor(state: ConnectionState): Color = when (state) {
    ConnectionState.Connected -> Palette.Green
    ConnectionState.Connecting -> Palette.Orange
    ConnectionState.Failed -> Palette.Red
    else -> Palette.Secondary
}

fun connectionText(state: ConnectionState): String = when (state) {
    ConnectionState.Connected -> "接続済み"
    ConnectionState.Connecting -> "接続中…"
    ConnectionState.Failed -> "接続エラー"
    else -> "未接続"
}
