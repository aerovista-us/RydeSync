package com.aerovista.rydesync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { RydeSyncHome() } }
    }
}

@Composable
private fun RydeSyncHome() {
    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("RYDESYNC", style = MaterialTheme.typography.headlineLarge)
            Text("Android foundation · public ride rooms + AV Identity adapter + Media3 shared soundtrack")
            Text("Server: ${RydeSyncRuntime.baseUrl}")
            Button(onClick = { /* AV Identity/Firebase adapter lands here without changing room/media contracts. */ }) {
                Text("Connect AeroVista Identity")
            }
            Text("Guest ride joining remains available even while identity integration is being stabilized.")
        }
    }
}
