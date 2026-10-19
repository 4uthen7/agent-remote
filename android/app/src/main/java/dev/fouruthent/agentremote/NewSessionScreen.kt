package dev.fouruthent.agentremote

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.Button
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class RuntimeChoice(val id: String, val title: String, val subtitle: String)

private val runtimeChoices = listOf(
    RuntimeChoice("dsh", "DeepSeek Harness", "ACP · ローカル"),
    RuntimeChoice("codex", "Codex", "app-server · ChatGPT"),
    RuntimeChoice("claude", "Claude Code", "Agent SDK · 要ログイン"),
)

@Composable
fun NewSessionScreen(state: UiState, store: AgentStore) {
    var cwd by remember { mutableStateOf(state.lastCwd) }
    var runtime by remember { mutableStateOf(state.selectedRuntime) }
    BackHandler { store.back() }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 20.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(top = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = store::back) { Text("キャンセル", fontSize = 16.sp) }
            Spacer(Modifier.weight(1f))
            Text("新規セッション", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.width(72.dp))
        }
        Spacer(Modifier.height(24.dp))

        if (state.lastError != null) {
            ErrorCard(state.lastError)
            Spacer(Modifier.height(14.dp))
        }

        SectionLabel("ランタイム")
        GroupCard {
            runtimeChoices.forEachIndexed { index, choice ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable {
                            runtime = choice.id
                            store.setRuntime(choice.id)
                        }
                        .padding(horizontal = 14.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        choice.title,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.weight(1f),
                    )
                    if (runtime == choice.id) {
                        Icon(Icons.Outlined.Check, null, tint = Palette.Blue, modifier = Modifier.size(18.dp))
                    }
                }
                if (index != runtimeChoices.lastIndex) GroupDivider()
            }
        }
        Text(
            "各ランタイムのCLIにログインしている必要があります。",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, top = 8.dp),
        )
        Spacer(Modifier.height(24.dp))

        SectionLabel("作業ディレクトリ")
        GroupCard {
            Row(
                Modifier.padding(horizontal = 14.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Outlined.Folder, null, tint = Palette.Secondary, modifier = Modifier.size(17.dp))
                BasicTextField(
                    value = cwd,
                    onValueChange = {
                        cwd = it
                        store.setCwd(it)
                    },
                    singleLine = true,
                    textStyle = TextStyle(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (cwd.isBlank()) {
                            Text("~/Documents/project", color = Palette.Secondary, fontSize = 14.sp)
                        }
                        inner()
                    },
                )
            }
        }
        Text(
            "agentd の許可ルート内のパスを指定してください。通常はホームディレクトリ配下です。",
            fontSize = 12.sp,
            lineHeight = 17.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, top = 8.dp),
        )
        Spacer(Modifier.height(26.dp))

        Button(
            onClick = { store.createSession(cwd, runtime) },
            enabled = cwd.isNotBlank() && state.connection == ConnectionState.Connected,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            Text("セッションを開始", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(40.dp))
    }
}
