package dev.fouruthent.agentremote

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity

@Composable
fun AppLockScreen(appLock: AppLock, state: AppLockUiState) {
    BackHandler(enabled = true) {}
    val activity = LocalContext.current as? FragmentActivity
    var password by rememberSaveable { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var didAutoPrompt by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (!didAutoPrompt && state.biometricEnabled && state.biometricAvailable && activity != null) {
            didAutoPrompt = true
            appLock.authenticate(activity) { message -> errorMessage = message }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .imePadding(),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(70.dp))
            TerminalMark(82.dp)
            Spacer(Modifier.height(20.dp))
            Text("Agent Remote", fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Text("ロック中", fontSize = 15.sp, color = Palette.Secondary)
            Spacer(Modifier.height(34.dp))

            if (state.biometricEnabled && state.biometricAvailable) {
                Button(
                    onClick = {
                        errorMessage = null
                        activity?.let { appLock.authenticate(it) { message -> errorMessage = message } }
                    },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(15.dp),
                ) {
                    Icon(
                        if (state.biometricLabel.contains("顔")) Icons.Outlined.Face else Icons.Outlined.Fingerprint,
                        null,
                        modifier = Modifier.padding(end = 8.dp),
                    )
                    Text("${state.biometricLabel}で解除", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(14.dp))
                Text("または", fontSize = 12.sp, color = Palette.Secondary)
                Spacer(Modifier.height(14.dp))
            } else if (!state.biometricAvailable) {
                Text(
                    "この端末では生体認証を利用できません。アプリパスワードで解除します。",
                    fontSize = 12.sp,
                    color = Palette.Secondary,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(14.dp))
            }

            OutlinedTextField(
                value = password,
                onValueChange = { password = it; errorMessage = null },
                label = { Text("アプリパスワード") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Go,
                ),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(15.dp),
            )
            if (errorMessage != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    errorMessage ?: "",
                    fontSize = 12.sp,
                    color = Palette.Red,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    if (!appLock.verifyPassword(password)) {
                        errorMessage = "パスワードが違います。"
                        password = ""
                    }
                },
                enabled = password.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(15.dp),
            ) {
                Icon(Icons.Outlined.Lock, null, modifier = Modifier.padding(end = 8.dp))
                Text("アプリパスワードで解除", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }

            Spacer(Modifier.height(20.dp))
            Text(
                "パスワードを忘れた場合は、アプリを再インストールする必要があります。",
                fontSize = 11.sp,
                lineHeight = 16.sp,
                color = Palette.Secondary,
            )
            Spacer(Modifier.height(30.dp))
        }
    }
}
