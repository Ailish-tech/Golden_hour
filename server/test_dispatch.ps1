$headers = @{ "Content-Type" = "application/json" }

# Test 1: Primary Reporter
$body1 = '{"userId": "FIRST-HERO-001", "lat": 26.9124, "lng": 75.7873}'
$res1 = Invoke-RestMethod -Uri 'http://localhost:3000/api/dispatch' -Method Post -Headers $headers -Body $body1
Write-Host "`n======================================================="
Write-Host "TEST 1 (PRIMARY REPORTER):"
Write-Host ($res1 | ConvertTo-Json)

# Test 2: Secondary Reporter (within 15m of primary)
$body2 = '{"userId": "SECOND-HERO-002", "lat": 26.9125, "lng": 75.7874}'
$res2 = Invoke-RestMethod -Uri 'http://localhost:3000/api/dispatch' -Method Post -Headers $headers -Body $body2
Write-Host "`n======================================================="
Write-Host "TEST 2 (SECONDARY REPORTER - AUTO MERGE):"
Write-Host ($res2 | ConvertTo-Json)
Write-Host "=======================================================`n"
