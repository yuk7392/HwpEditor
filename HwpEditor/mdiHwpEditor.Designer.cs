namespace HwpEditor
{
    partial class mdiHwpEditor
    {
        private System.ComponentModel.IContainer components = null;

        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null)) components.Dispose();
            base.Dispose(disposing);
        }

        #region Windows Form 디자이너에서 생성한 코드

        private void InitializeComponent()
        {
            this.pnlWeb = new System.Windows.Forms.Panel();
            this.SuspendLayout();
            // 
            // pnlWeb
            // 
            this.pnlWeb.BackColor = System.Drawing.Color.White;
            this.pnlWeb.Dock = System.Windows.Forms.DockStyle.Fill;
            this.pnlWeb.Location = new System.Drawing.Point(0, 0);
            this.pnlWeb.Name = "pnlWeb";
            this.pnlWeb.Size = new System.Drawing.Size(1024, 720);
            this.pnlWeb.TabIndex = 0;
            // 
            // mdiHwpEditor
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(96F, 96F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Dpi;
            this.BackColor = System.Drawing.Color.White;
            this.ClientSize = new System.Drawing.Size(1024, 720);
            this.Controls.Add(this.pnlWeb);
            this.Name = "mdiHwpEditor";
            this.ShowIcon = false;
            this.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
            this.Text = "HwpEditor";
            this.ResumeLayout(false);

        }

        #endregion

        private System.Windows.Forms.Panel pnlWeb;
    }
}
