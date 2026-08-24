$headers = @{ "Content-Type" = "application/json" }
$body = '{"userId": "HERO-DEMO-001", "lat": 26.9124, "lng": 75.7873}'
$res = Invoke-RestMethod -Uri 'http://localhost:3000/api/sos' -Method Post -Headers $headers -Body $body

Write-Host "Status:" $res.status
Write-Host "SHA-256 Hash:" $res.hash
Write-Host "Timestamp:" $res.timestamp
Write-Host "PDF Base64 Length:" $res.pdfBase64.Length

$pdfBytes = [System.Convert]::FromBase64String($res.pdfBase64)
[System.IO.File]::WriteAllBytes("c:\Users\Ailish\OneDrive\Desktop\YI\server\Sample_Good_Samaritan_Certificate.pdf", $pdfBytes)
Write-Host "Successfully wrote Sample_Good_Samaritan_Certificate.pdf!"
