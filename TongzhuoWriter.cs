using System;
using System.IO;
using System.Text;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using System.Threading.Tasks;

[DataContract] public class DailyBaseline {
 [DataMember] public string FileId;
 [DataMember] public string Day;
 [DataMember] public long Baseline;
 [DataMember] public long LastCount;
 [DataMember] public string LastSeenUtc;
}
[DataContract] public class BaselineStore { [DataMember] public List<DailyBaseline> Items=new List<DailyBaseline>(); }
[DataContract] public class CountRequest {
 [DataMember] public string p_key;
 [DataMember] public string p_day;
 [DataMember] public int p_delta;
}
public static class WordCounter {
 public static readonly TimeZoneInfo Zone=TimeZoneInfo.FindSystemTimeZoneById("China Standard Time");
 public static string Day(DateTime utc){return TimeZoneInfo.ConvertTimeFromUtc(utc,Zone).ToString("yyyy-MM-dd");}
 public static string FileId(string path){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(path).ToUpperInvariant()))).Replace("-","").ToLowerInvariant();}
 public static long ReadCount(string path){
  var info=new FileInfo(path);var length=info.Length;var modified=info.LastWriteTimeUtc;
  if(length>100*1024*1024)throw new IOException("TXT 超过 100 MB，请分卷后统计。");
  long count;
  try{count=ReadEncoded(path,new UTF8Encoding(false,true));}
  catch(DecoderFallbackException){count=ReadEncoded(path,Encoding.GetEncoding(54936));}
  info.Refresh();if(!info.Exists||info.Length!=length||info.LastWriteTimeUtc!=modified)throw new IOException("文件正在保存，下一次再统计。");
  return count;
 }
 static long ReadEncoded(string path,Encoding encoding){
  using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
  using(var reader=new StreamReader(stream,encoding,true,8192)){
   long count=0;bool high=false;var chars=new char[8192];int n;
   while((n=reader.Read(chars,0,chars.Length))>0)for(int i=0;i<n;i++){
    char c=chars[i];if(Char.IsLowSurrogate(c)&&high){high=false;continue;}
    high=Char.IsHighSurrogate(c);if(!Char.IsWhiteSpace(c)&&c!='\uFEFF')count++;
   }
   Array.Clear(chars,0,chars.Length);return count;
  }
 }
 public static long Update(DailyBaseline record,long current,DateTime now){
  var day=Day(now);
  if(record.Day!=day){
   DateTime seen;bool running=DateTime.TryParse(record.LastSeenUtc,null,System.Globalization.DateTimeStyles.RoundtripKind,out seen)&&(now-seen.ToUniversalTime()).TotalSeconds<=45&&(now-seen.ToUniversalTime()).TotalSeconds>=0;
   record.Baseline=running?record.LastCount:current;record.Day=day;
  }
  record.LastCount=current;record.LastSeenUtc=now.ToString("o");return current-record.Baseline;
 }
 public static byte[] Json(object value,Type type){using(var m=new MemoryStream()){new DataContractJsonSerializer(type).WriteObject(m,value);return m.ToArray();}}
}
public class WriterWindow:Form {
 const string Url="https://pbcsjuccvlcbymisesxz.supabase.co/rest/v1/rpc/writer_sync";
 const string PublicKey="sb_publishable_aPcZWPnrHlkfj0FZam6YFw_hsMAQIud";
 TextBox fileBox,keyBox;Label status,countLabel,privacy;Button choose,start,stop;NotifyIcon tray;
 readonly Timer timer=new Timer();readonly HttpClient http=new HttpClient();
 string path="",currentKey="",storePath;BaselineStore store;bool running,busy;int generation;
 public WriterWindow(){
  Text="同桌 · 陪你写字数小助手";Size=new Size(620,540);MinimumSize=new Size(560,510);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Microsoft YaHei UI",10);BackColor=Color.FromArgb(247,247,238);
  var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(25),ColumnCount=1,RowCount=10};layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));Controls.Add(layout);
  var title=new Label{Text="你安心写，鼠鼠在旁边。",Font=new Font(Font.FontFamily,19,FontStyle.Bold),AutoSize=true,Margin=new Padding(0,0,0,12)};layout.Controls.Add(title);
  privacy=new Label{Text="只在这台电脑计数。正文、文件名和路径不会发送到网页。\n每 10 秒上传：日期、净增字数。含标点，不计空白。",AutoSize=true,ForeColor=Color.FromArgb(78,108,85),Margin=new Padding(0,0,0,12)};layout.Controls.Add(privacy);
  var fileRow=new TableLayoutPanel{ColumnCount=2,Dock=DockStyle.Top,Height=42};fileRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));fileRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,105));fileBox=new TextBox{ReadOnly=true,Dock=DockStyle.Fill,Text="请在本机选择正在写的 TXT"};choose=new Button{Text="选择 TXT",Dock=DockStyle.Fill};fileRow.Controls.Add(fileBox);fileRow.Controls.Add(choose);layout.Controls.Add(fileRow);
  layout.Controls.Add(new Label{Text="姐姐网页 → 陪你写 → 生成连接码，复制到这里：",AutoSize=true,Margin=new Padding(0,13,0,4)});
  keyBox=new TextBox{UseSystemPasswordChar=true,Dock=DockStyle.Top,MaxLength=64};layout.Controls.Add(keyBox);
  var actions=new FlowLayoutPanel{Height=45,Dock=DockStyle.Top,Margin=new Padding(0,14,0,0)};start=new Button{Text="开始同步",Width=125,Height=35};stop=new Button{Text="暂停",Width=85,Height=35,Enabled=false};actions.Controls.Add(start);actions.Controls.Add(stop);layout.Controls.Add(actions);
  countLabel=new Label{Text="今天净增：等待开始",Font=new Font(Font.FontFamily,17),AutoSize=true,Margin=new Padding(0,16,0,10)};layout.Controls.Add(countLabel);
  status=new Label{Text="未连接。第一次接入当天，从此刻开始计数。",AutoSize=true,MaximumSize=new Size(530,100)};layout.Controls.Add(status);
  layout.Controls.Add(new Label{Text="TXT 保存到磁盘后才能统计；未保存的编辑不会计入。\n暂停期间修改的字数，会在同一天恢复后补上。\n首次启动或隔天重新打开时，无法追溯此前的字数。\n最小化后继续运行；关闭窗口会停止同步。",AutoSize=true,ForeColor=Color.Gray,Margin=new Padding(0,20,0,0)});
  choose.Click+=(s,e)=>{using(var d=new OpenFileDialog{Filter="文本文件 (*.txt)|*.txt",Title="选择正在写作的 TXT"})if(d.ShowDialog()==DialogResult.OK){Pause();path=d.FileName;fileBox.Text=path;status.Text="已选择。点击开始同步。";}};
  start.Click+=async(s,e)=>{if(!File.Exists(path)){status.Text="请先选择一个存在的 TXT。";return;}var k=keyBox.Text.Trim();if(!System.Text.RegularExpressions.Regex.IsMatch(k,"^[0-9a-f]{64}$")){status.Text="请从姐姐的网页复制完整连接码。";return;}currentKey=k;running=true;generation++;start.Enabled=false;stop.Enabled=true;keyBox.Enabled=false;choose.Enabled=false;timer.Start();await Tick();};
  stop.Click+=(s,e)=>Pause();timer.Interval=10000;timer.Tick+=async(s,e)=>await Tick();
  tray=new NotifyIcon{Icon=SystemIcons.Information,Text="同桌 · 正在陪你写",Visible=false};tray.DoubleClick+=(s,e)=>{Show();WindowState=FormWindowState.Normal;tray.Visible=false;};Resize+=(s,e)=>{if(WindowState==FormWindowState.Minimized){tray.Visible=true;Hide();}};
  FormClosed+=(s,e)=>{timer.Stop();tray.Dispose();http.Dispose();};
  http.Timeout=TimeSpan.FromSeconds(12);http.DefaultRequestHeaders.Add("apikey",PublicKey);
  storePath=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TongzhuoWriter","counts.json");
  try{using(var m=File.OpenRead(storePath))store=(BaselineStore)new DataContractJsonSerializer(typeof(BaselineStore)).ReadObject(m);}catch{store=new BaselineStore();}
 }
 void Pause(){running=false;generation++;timer.Stop();start.Enabled=true;stop.Enabled=false;keyBox.Enabled=true;choose.Enabled=true;status.Text="已暂停，不再上传；本机字数基线保留。";}
 void Save(){Directory.CreateDirectory(Path.GetDirectoryName(storePath));var temp=storePath+".tmp";File.WriteAllBytes(temp,WordCounter.Json(store,typeof(BaselineStore)));if(File.Exists(storePath))File.Replace(temp,storePath,null);else File.Move(temp,storePath);}
 async Task Tick(){
  if(!running||busy)return;busy=true;int currentGeneration=generation;string currentPath=path;
  try{
   long total=await Task.Run(()=>WordCounter.ReadCount(currentPath));if(!running||generation!=currentGeneration)return;
   var id=WordCounter.FileId(currentPath);var record=store.Items.Find(x=>x.FileId==id);if(record==null){record=new DailyBaseline{FileId=id};store.Items.Add(record);}
   long delta=WordCounter.Update(record,total,DateTime.UtcNow);Save();
   if(Math.Abs(delta)>10000000){status.Text="当日净增超过支持范围，已停止上传。";Pause();return;}
   countLabel.Text="今天净增："+delta.ToString("N0")+" 字";
   // This DTO is the complete network boundary. Never add text, paths or filenames.
   var payload=new CountRequest{p_key=currentKey,p_day=record.Day,p_delta=(int)delta};
   using(var body=new StringContent(Encoding.UTF8.GetString(WordCounter.Json(payload,typeof(CountRequest))),Encoding.UTF8,"application/json"))
   using(var response=await http.PostAsync(Url,body)){
    if(!running||generation!=currentGeneration)return;
    if(!response.IsSuccessStatusCode){status.Text="同步失败：请检查连接码是否过期或已撤销。10 秒后重试；本机基线保留。";return;}
   }
   status.Text="已同步 · "+TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,WordCounter.Zone).ToString("HH:mm:ss")+" · 只发送了日期和字数。";
  }catch(IOException){if(running)status.Text="文件正在保存或暂不可读，下一次重试；没有上传正文。";}
   catch(UnauthorizedAccessException){if(running)status.Text="无法读取 TXT，请检查本机文件权限或重新选择。";}
   catch{if(running)status.Text="暂时无法同步，10 秒后重试；本机字数基线仍在。";}
   finally{busy=false;}
 }
}
public static class Program {
 [STAThread] public static void Main(string[] args){
  ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
  if(args.Length==2&&args[0]=="--self-test"){try{SelfTest();File.WriteAllText(args[1],"PASS: encodings, Unicode, deletion, restart, midnight and network boundary",Encoding.UTF8);Environment.ExitCode=0;}catch(Exception e){File.WriteAllText(args[1],"FAIL: "+e.Message,Encoding.UTF8);Environment.ExitCode=1;}return;}
  Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new WriterWindow());
 }
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static void SelfTest(){
  string path=Path.GetTempFileName();try{
   foreach(var e in new Encoding[]{new UTF8Encoding(false,true),Encoding.Unicode,Encoding.BigEndianUnicode,Encoding.GetEncoding(54936)}){File.WriteAllText(path,"姐姐 写书\r\n你好！",e);Check(WordCounter.ReadCount(path)==7,"encoding "+e.WebName);}
   File.WriteAllText(path,"甲😀乙 \n",new UTF8Encoding(false,true));Check(WordCounter.ReadCount(path)==3,"Unicode codepoints");
  }finally{File.Delete(path);}
  var r=new DailyBaseline();var now=new DateTime(2026,10,17,8,0,0,DateTimeKind.Utc);
  Check(WordCounter.Update(r,100,now)==0,"first baseline");Check(WordCounter.Update(r,125,now.AddSeconds(10))==25,"add");Check(WordCounter.Update(r,90,now.AddSeconds(20))==-10,"delete");
  var bytes=WordCounter.Json(r,typeof(DailyBaseline));using(var m=new MemoryStream(bytes))r=(DailyBaseline)new DataContractJsonSerializer(typeof(DailyBaseline)).ReadObject(m);Check(WordCounter.Update(r,135,now.AddHours(2))==35,"restart same day");
  var edge=new DateTime(2026,10,17,15,59,58,DateTimeKind.Utc);WordCounter.Update(r,140,edge);Check(WordCounter.Update(r,143,edge.AddSeconds(10))==3,"midnight running");Check(WordCounter.Update(r,180,edge.AddDays(2))==0,"offline new day");
  string json=Encoding.UTF8.GetString(WordCounter.Json(new CountRequest{p_key="test",p_day="2026-10-17",p_delta=25},typeof(CountRequest)));Check(json.IndexOf("p_delta")>=0&&json.IndexOf("FileId")<0&&json.IndexOf("Baseline")<0&&json.IndexOf("path")<0&&json.IndexOf("text")<0,"network boundary");
 }
}
